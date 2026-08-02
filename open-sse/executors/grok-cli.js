import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_VERSION,
  supportsGrokCliReasoningEffort,
} from "../config/grokCli.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getConsistentMachineId } from "../shared/machineId.js";

// Server-generated item id prefixes that /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types executed server-side by Grok CLI backend
const HOSTED_TOOL_TYPES = new Set([
  "web_search",
  "x_search",
  "web_search_preview",
  "file_search",
  "image_generation",
  "code_interpreter",
  "mcp",
  "local_shell",
]);

// Fields accepted by cli-chat-proxy Responses API (mirrors Codex allowlist + Grok extras)
const RESPONSES_API_ALLOWLIST = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "stream",
  "store",
  "reasoning",
  "include",
  "temperature",
  "top_p",
  "max_output_tokens",
  "parallel_tool_calls",
  "text",
  "metadata",
  "prompt_cache_key",
]);

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];
const GROK_CLI_TURN_STORE_MAX = 5000;
const GROK_CLI_NATIVE_ITEM_ID = /^(?:rs|msg|fc)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROK_CLI_FREEFORM_TOOL_PARAMETERS = {
  type: "object",
  properties: { input: { type: "string" } },
  required: ["input"],
};

// Per-session last turn index so multi-turn headers never go backwards within this process
const sessionTurnStore = new Map();
let requestTurnStore = new WeakMap();

/**
 * Count user turns in a Responses `input` array.
 * Official CLI sets x-grok-turn-idx to the 1-based conversation turn (≈ user messages).
 * HAR: first chat turn → "1".
 */
export function countGrokCliUserTurns(input) {
  if (!Array.isArray(input)) return 1;
  let n = 0;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = typeof item.type === "string" ? item.type : "";
    // Responses message items (type omitted or "message") with role user
    if (item.role === "user" && (!type || type === "message")) n += 1;
  }
  return Math.max(1, n);
}

/**
 * Resolve monotonic turn index for a session.
 * Prefers user-message count from the payload (full history clients), but never
 * decreases vs the last index observed for the same sessionId in this process.
 */
export function resolveGrokCliTurnIdx(sessionId, input, requestKey = null) {
  const fromInput = countGrokCliUserTurns(input);
  if (!sessionId) return fromInput;

  if (requestKey && requestTurnStore.has(requestKey)) {
    return requestTurnStore.get(requestKey);
  }

  const now = Date.now();
  const existing = sessionTurnStore.get(sessionId);
  const prev = existing && now - existing.lastUsed <= MEMORY_CONFIG.sessionTtlMs
    ? existing.turn
    : 0;
  if (existing) sessionTurnStore.delete(sessionId);

  // A new delta-style request advances the turn; retries reuse requestKey.
  const turn = prev > 0 ? Math.max(fromInput, prev + (requestKey ? 1 : 0)) : fromInput;
  while (sessionTurnStore.size >= GROK_CLI_TURN_STORE_MAX) {
    sessionTurnStore.delete(sessionTurnStore.keys().next().value);
  }
  sessionTurnStore.set(sessionId, { turn, lastUsed: now });
  if (requestKey) requestTurnStore.set(requestKey, turn);
  return turn;
}

/** Test helper — clear in-memory turn counters */
export function _resetGrokCliTurnStore() {
  sessionTurnStore.clear();
  requestTurnStore = new WeakMap();
}

export function _getGrokCliTurnStoreSize() {
  return sessionTurnStore.size;
}

export function normalizeGrokCliEffort(value) {
  const effort = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (effort === "max") return "xhigh";
  if (EFFORT_LEVELS.includes(effort)) return effort;
  return "high";
}

export { supportsGrokCliReasoningEffort } from "../config/grokCli.js";

export function resolveGrokCliSessionId(credentials, body) {
  // ponytail: clients without stable thread metadata share one connection session;
  // split further when their wire format exposes a durable conversation id.
  const explicitSessionBody = {
    prompt_cache_key: body?.prompt_cache_key,
    session_id: body?.session_id,
    conversation_id: body?.conversation_id,
    metadata: body?.metadata,
  };
  return resolveSessionId({
    headers: credentials?.rawHeaders,
    body: explicitSessionBody,
    connectionId: credentials?.connectionId || credentials?.id,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "grok-cli",
  });
}

function stringifyGrokCliToolOutput(output) {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  return JSON.stringify(output);
}

function isNativeGrokCliItemId(id) {
  return typeof id === "string" && GROK_CLI_NATIVE_ITEM_ID.test(id);
}

function normalizeGrokCliInputItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const { internal_chat_message_metadata_passthrough: _metadata, ...clean } = item;

  if (item.type === "reasoning") {
    if (!isNativeGrokCliItemId(item.id) || typeof item.encrypted_content !== "string") return null;
    return clean;
  }

  if (item.type === "custom_tool_call") {
    const callId = item.call_id || item.id;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!callId || !name) return null;
    return {
      type: "function_call",
      call_id: callId,
      name,
      arguments: JSON.stringify({ input: stringifyGrokCliToolOutput(item.input ?? item.arguments) }),
    };
  }

  if (item.type === "custom_tool_call_output" || item.type === "function_call_output") {
    const callId = item.call_id || item.id;
    if (!callId) return null;
    return {
      type: "function_call_output",
      call_id: callId,
      output: stringifyGrokCliToolOutput(item.output),
    };
  }

  if (item.type === "function_call") {
    const callId = item.call_id || item.id;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!callId || !name) return null;
    return {
      type: "function_call",
      ...(isNativeGrokCliItemId(item.id) ? { id: item.id } : {}),
      call_id: callId,
      name,
      arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
      ...(typeof item.status === "string" ? { status: item.status } : {}),
    };
  }

  return clean;
}

export function normalizeGrokCliInput(body) {
  if (!Array.isArray(body?.input)) return body;
  const normalized = body.input.map(normalizeGrokCliInputItem).filter(Boolean);
  const callIds = new Set(
    normalized
      .filter((item) => item?.type === "function_call" && item.call_id)
      .map((item) => item.call_id)
  );
  body.input = normalized.filter(
    (item) => item?.type !== "function_call_output" || callIds.has(item.call_id)
  );
  return body;
}

function stripStoredItemReferences(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.type === "item_reference") return false;
      if (
        typeof item.id === "string" &&
        SERVER_ID_PATTERN.test(item.id) &&
        !isNativeGrokCliItemId(item.id)
      ) delete item.id;
    }
    return true;
  });
}

/**
 * Flatten Chat Completions tool shape → Responses flat format.
 * Keep hosted tools (web_search / x_search) passthrough.
 */
function normalizeGrokCliTools(body) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
    return;
  }
  const validNames = new Set();
  const hostedTypes = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const type = typeof tool.type === "string" ? tool.type : "";

    if (type !== "function") {
      // Hosted tools: { type: "web_search" } / { type: "x_search" }
      if (HOSTED_TOOL_TYPES.has(type)) {
        hostedTypes.add(type);
        return true;
      }
      // Nested function shape without type
      if (!type && tool.function) {
        // fall through to function flatten below
      } else if (!type || typeof tool.name === "string") {
        // treat as bare function if name present
      } else {
        return false;
      }
    }

    const isFunction =
      type === "function" || type === "" || tool.function || typeof tool.name === "string";
    if (!isFunction || HOSTED_TOOL_TYPES.has(type)) {
      return HOSTED_TOOL_TYPES.has(type);
    }

    const fn =
      tool.function && typeof tool.function === "object" && !Array.isArray(tool.function)
        ? tool.function
        : null;
    const rawName =
      typeof tool.name === "string" ? tool.name : typeof fn?.name === "string" ? fn.name : "";
    const name = rawName.trim();
    if (!name) return false;

    const description =
      typeof tool.description === "string"
        ? tool.description
        : typeof fn?.description === "string"
          ? fn.description
          : "";
    const parameters = type === "custom"
      ? GROK_CLI_FREEFORM_TOOL_PARAMETERS
      : tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
        ? tool.parameters
        : fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters)
          ? fn.parameters
          : { type: "object", properties: {} };

    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, 128);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });

  if (body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
    return;
  }

  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    const choiceType = typeof body.tool_choice.type === "string" ? body.tool_choice.type : "";
    if (choiceType === "function" || choiceType === "custom") {
      const rawName = body.tool_choice.name ?? body.tool_choice.function?.name;
      const name = typeof rawName === "string" ? rawName.trim().slice(0, 128) : "";
      if (!name || !validNames.has(name)) delete body.tool_choice;
      else body.tool_choice = { type: "function", name };
    } else if (!hostedTypes.has(choiceType)) {
      delete body.tool_choice;
    }
  }
}

function resolveEffortFromModel(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  for (const level of EFFORT_LEVELS) {
    if (modelId.endsWith(`-${level}`)) return level;
  }
  return null;
}

/**
 * Grok CLI Executor — OpenAI Responses API on cli-chat-proxy.grok.com
 * Auth: OAuth device-code access token (xai-grok-cli).
 */
export class GrokCliExecutor extends BaseExecutor {
  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
    this._currentSessionId = null;
    this._currentReqId = null;
    this._currentTurnIdx = 1;
    this._agentId = null;
  }

  buildUrl() {
    return this.config.baseUrl;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("grok-cli", credentials, log, proxyOptions);
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials("grok-cli", credentials);
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);

    // Static fingerprint from registry
    const staticHeaders = this.config.headers || {};
    for (const [k, v] of Object.entries(staticHeaders)) {
      if (v != null && headers[k] === undefined) headers[k] = v;
    }

    headers["x-grok-client-identifier"] =
      this.config.clientIdentifier || headers["x-grok-client-identifier"] || GROK_CLI_CLIENT_IDENTIFIER;
    headers["x-grok-client-version"] =
      this.config.clientVersion || headers["x-grok-client-version"] || GROK_CLI_VERSION;

    const sessionId = this._currentSessionId || credentials?.connectionId || crypto.randomUUID();
    const reqId = this._currentReqId || crypto.randomUUID();
    headers["x-grok-session-id"] = sessionId;
    // CLI uses the same id for conv + session on chat turns
    headers["x-grok-conv-id"] = sessionId;
    headers["x-grok-req-id"] = reqId;
    headers["x-grok-turn-idx"] = String(this._currentTurnIdx || 1);

    if (this._agentId) headers["x-grok-agent-id"] = this._agentId;

    // Surface model override (CLI always sets this)
    if (this._currentModel) headers["x-grok-model-override"] = this._currentModel;

    // Identity: mapTokens stores email top-level AND in providerSpecificData;
    // fall back either way so OAuth connections always fingerprint like the CLI.
    const psd = credentials?.providerSpecificData || {};
    const email = psd.email || credentials?.email;
    const userId = psd.userId || credentials?.userId || credentials?.providerUserId;
    if (email) headers["x-email"] = email;
    if (userId) headers["x-userid"] = userId;

    return headers;
  }

  parseError(response, bodyText) {
    // 402 personal-team-blocked:spending-limit → surface as payment/quota for fallback
    if (response.status === 402 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const code = json?.code || "";
        const msg = json?.error || json?.message || bodyText;
        return {
          status: 402,
          message: typeof msg === "string" ? msg : bodyText,
          code: typeof code === "string" ? code : undefined,
        };
      } catch {
        /* fall through */
      }
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model, body, stream, credentials) {
    // Session / request ids for headers — stable per client conversation when possible
    const requestKey = body;
    this._currentSessionId = resolveGrokCliSessionId(credentials, body);
    this._currentReqId = crypto.randomUUID();
    this._agentId =
      credentials?.providerSpecificData?.deviceId ||
      credentials?.providerSpecificData?.agentId ||
      null;

    // Normalize Responses input
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;

    // Chat Completions clients arrive with messages[] — translator should have
    // converted already, but guard empty input.
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      if (Array.isArray(body.messages) && body.messages.length > 0) {
        // Soft fallback: map messages → input messages (string content only)
        body.input = body.messages.map((m) => ({
          type: "message",
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
        }));
        delete body.messages;
      } else {
        body.input = [{ type: "message", role: "user", content: "..." }];
      }
    }

    // Keep role:"system" as-is — official grok-pager HAR sends system, not developer
    // (Codex converts system→developer; Grok CLI does not).
    normalizeGrokCliInput(body);
    stripStoredItemReferences(body);
    normalizeGrokCliTools(body);

    // Turn index after input is finalized (user-message count, monotonic per session)
    this._currentTurnIdx = resolveGrokCliTurnIdx(this._currentSessionId, body.input, requestKey);

    body.stream = true;
    body.store = false;

    // Resolve upstream model id (strip effort suffix virtual models)
    let modelEffort = resolveEffortFromModel(body.model || model);
    let resolvedModel = body.model || model;
    if (modelEffort) {
      resolvedModel = resolvedModel.replace(new RegExp(`-${modelEffort}$`), "");
    }
    resolvedModel = getModelUpstreamId("gcli", resolvedModel) || resolvedModel;
    // Also try provider id key
    if (resolvedModel === (body.model || model)) {
      resolvedModel = getModelUpstreamId("grok-cli", resolvedModel) || resolvedModel;
    }
    body.model = resolvedModel;
    this._currentModel = resolvedModel;

    // Reasoning effort priority: explicit > reasoning_effort > model suffix > default high.
    // grok-build and Composer reject reasoningEffort but still accept summary/encrypted continuity.
    const supportsReasoningEffort = supportsGrokCliReasoningEffort(resolvedModel);
    if (!body.reasoning || typeof body.reasoning !== "object") {
      body.reasoning = { summary: "concise" };
      if (supportsReasoningEffort) {
        body.reasoning.effort = normalizeGrokCliEffort(body.reasoning_effort || modelEffort);
      }
    } else {
      if (supportsReasoningEffort) {
        body.reasoning.effort = normalizeGrokCliEffort(
          body.reasoning.effort || body.reasoning_effort || modelEffort,
        );
      } else {
        delete body.reasoning.effort;
      }
      if (!body.reasoning.summary) body.reasoning.summary = "concise";
    }
    delete body.reasoning_effort;

    // Encrypted reasoning for multi-turn continuity (CLI always requests this)
    if (body.reasoning && body.reasoning.effort !== "none") {
      const include = Array.isArray(body.include) ? body.include : [];
      if (!include.includes("reasoning.encrypted_content")) {
        include.push("reasoning.encrypted_content");
      }
      body.include = include;
    }

    // Drop Chat Completions leftovers that Responses rejects
    delete body.messages;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.n;
    delete body.seed;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logit_bias;
    delete body.user;
    delete body.stream_options;
    delete body.prompt_cache_retention;
    delete body.safety_identifier;
    delete body.previous_response_id; // store=false → cannot resolve

    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }

  async execute(args) {
    // Lazy-resolve stable agent id once per process if connection has none
    if (!this._agentId && !args.credentials?.providerSpecificData?.deviceId) {
      try {
        const mid = await getConsistentMachineId("grok-cli-agent");
        // Format as UUID-ish for header aesthetics
        this._agentId = [
          mid.slice(0, 8),
          mid.slice(8, 12),
          "5" + mid.slice(13, 16),
          "a" + mid.slice(17, 20),
          mid.slice(0, 12).padEnd(12, "0"),
        ].join("-");
      } catch {
        this._agentId = crypto.randomUUID();
      }
    } else if (args.credentials?.providerSpecificData?.deviceId) {
      this._agentId = args.credentials.providerSpecificData.deviceId;
    }

    return super.execute(args);
  }
}

export default GrokCliExecutor;
