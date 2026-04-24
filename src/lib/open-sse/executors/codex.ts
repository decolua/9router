import { createHash } from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions";
import { fetchImageAsBase64 } from "../translator/helpers/imageHelper";
import { normalizeResponsesInput } from "../translator/helpers/responsesApiHelper";
import { getConsistentMachineId } from "@/shared/utils/machineId";

// In-memory map: hash(machineId + first assistant content) → { sessionId, lastUsed }
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const assistantSessionMap = new Map<string, { sessionId: string, lastUsed: number }>();

// Cache machine ID at module level (resolved once)
let cachedMachineId: string | null = null;
getConsistentMachineId().then(id => { cachedMachineId = id; });

function hashContent(text: string) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function generateSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Extract text content from an input item
function extractItemText(item: any): string {
  if (!item) return "";
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content.map((c: any) => c.text || c.output || "").filter(Boolean).join("");
  }
  return "";
}

// Resolve session_id from first assistant message + machineId to avoid cross-user collision
function resolveConversationSessionId(input: any[], machineId: string | null) {
  const machineSessionId = machineId ? `sess_${hashContent(machineId)}` : generateSessionId();
  if (!Array.isArray(input) || input.length === 0) return machineSessionId;

  // Find first assistant message that has actual text content
  let text = "";
  for (const item of input) {
    if (item.role === "assistant") {
      text = extractItemText(item);
      if (text) break;
    }
  }
  if (!text) return machineSessionId;

  const hash = hashContent((machineId || "") + text);
  const entry = assistantSessionMap.get(hash);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.sessionId;
  }

  const sessionId = generateSessionId();
  assistantSessionMap.set(hash, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of assistantSessionMap) {
    if (now - entry.lastUsed > SESSION_TTL_MS) assistantSessionMap.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 */
export class CodexExecutor extends BaseExecutor {
  _currentSessionId: string | null = null;
  _isCompact: boolean = false;

  constructor() {
    super("codex", PROVIDERS.codex);
    this._currentSessionId = null;
  }

  buildHeaders(credentials: any, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    headers["session_id"] = this._currentSessionId || credentials?.connectionId || "default";
    return headers;
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0, credentials = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return this._isCompact ? `${base}/compact` : base;
  }

  async prefetchImages(body: any) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input) {
      if (!Array.isArray(item.content)) continue;
      const pending = item.content.map(async (c: any) => {
        if (c.type !== "image_url") return c;
        const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url;
        const detail = c.image_url?.detail || "auto";
        if (!url) return c;
        if (url.startsWith("data:")) return { type: "input_image", image_url: url, detail };
        const fetched = await fetchImageAsBase64(url, { timeoutMs: 15000 });
        return { type: "input_image", image_url: fetched?.url || url, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  async execute(args: any) {
    await this.prefetchImages(args.body);
    return super.execute(args);
  }

  transformRequest(model: string, body: any, stream: boolean, credentials: any) {
    this._isCompact = !!body._compact;
    delete body._compact;
    this._currentSessionId = resolveConversationSessionId(body.input, cachedMachineId);
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }

    body.stream = true;

    if (!body.instructions || body.instructions.trim() === "") {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    body.store = false;

    const effortLevels = ['none', 'low', 'medium', 'high', 'xhigh'];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (model.endsWith(`-${level}`)) {
        modelEffort = level;
        body.model = body.model.replace(`-${level}`, '');
        break;
      }
    }

    if (!body.reasoning) {
      const effort = body.reasoning_effort || modelEffort || 'low';
      body.reasoning = { effort, summary: "auto" };
    } else if (!body.reasoning.summary) {
      body.reasoning.summary = "auto";
    }
    delete body.reasoning_effort;

    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
    }

    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.user;
    delete body.prompt_cache_retention;
    delete body.metadata;
    delete body.stream_options;
    delete body.safety_identifier;

    return body;
  }
}
