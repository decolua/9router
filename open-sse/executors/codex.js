import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { clampResponsesCallId, MAX_RESPONSES_CALL_ID_LEN, normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { fetchImageAsBase64 } from "../translator/concerns/image.js";
import { ROLE, RESPONSES_ITEM } from "../translator/schema/index.js";
import { getModelUpstreamId, getProviderModels } from "../config/providerModels.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { DEFAULT_RETRY_CONFIG, HTTP_STATUS, resolveRetryEntry } from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { stripCodexUnsupportedPatterns } from "../utils/codexToolSchema.js";

// SSE error patterns inside 200-OK bodies. Some retry same account first; capacity rotates accounts.
const CODEX_SSE_RETRY_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];
const CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS = ["selected model is at capacity", "model_at_capacity"];
const CODEX_SSE_USER_OUTPUT_EVENTS = new Set([
  "response.output_text.delta",
  "response.output_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.output_item.done",
]);
const CODEX_SSE_PEEK_BYTES = 256 * 1024;
const CODEX_MODEL_CAPACITY_MESSAGE = "Selected model is at capacity. Please try a different model.";
function isCodexResponsesLiteModel(model) {
  const baseId = String(model || "").replace(/\([^()]+\)\s*$/, "");
  return getProviderModels("cx").some((entry) => entry.id === baseId && entry.responsesLite === true);
}

// Server-generated item id prefixes that Codex /responses cannot resolve when store=false
const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

// Hosted tool types that Codex/OpenAI Responses executes server-side
const CODEX_HOSTED_TOOL_TYPES = new Set([
  "image_generation", "web_search", "web_search_preview", "file_search",
  "computer", "computer_use_preview", "code_interpreter", "mcp", "local_shell",
  "tool_search"
]);

// Responses-native freeform tools carry a name plus format payload and must pass through intact.
const CODEX_PASSTHROUGH_TOOL_TYPES = new Set(["custom"]);

// Allowlist of fields accepted by Codex Responses API — anything else is stripped
const RESPONSES_API_ALLOWLIST = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "stream", "store",
  "reasoning", "service_tier", "include", "prompt_cache_key", "client_metadata",
  "text", "parallel_tool_calls"
]);

// Convert role=system → role=developer in body.input (keeps content in cacheable prefix)
function convertSystemToDeveloperRole(body) {
  if (!Array.isArray(body.input)) return;
  for (const item of body.input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const isSystemMsg = item.role === "system" && (!item.type || item.type === "message");
    if (isSystemMsg) item.role = "developer";
  }
}

// Strip server-generated item IDs (rs_/fc_/resp_/msg_) from input — avoids 404 with store=false
function stripStoredItemReferences(body, preserveLitePrefix = false) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (typeof item === "string" && SERVER_ID_PATTERN.test(item)) return false;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (item.type === "item_reference") return false;
      if (typeof item.id === "string" && SERVER_ID_PATTERN.test(item.id)
        && !(preserveLitePrefix && item.role === "developer" && item.id.startsWith("msg_"))) delete item.id;
    }
    return true;
  });
}
const CODEX_TOOL_CALL_TYPES = new Map([
  [RESPONSES_ITEM.FUNCTION_CALL, "function"],
  [RESPONSES_ITEM.CUSTOM_TOOL_CALL, "custom"],
  [RESPONSES_ITEM.COMPUTER_CALL, "computer"],
]);
const CODEX_TOOL_OUTPUT_TYPES = new Map([
  [RESPONSES_ITEM.FUNCTION_CALL_OUTPUT, "function"],
  [RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT, "custom"],
  [RESPONSES_ITEM.COMPUTER_CALL_OUTPUT, "computer"],
]);
const CODEX_ORPHAN_OUTPUT_LIMIT = 16_000;
const CODEX_INTERRUPTED_TOOL_OUTPUT = "[No tool output recorded: the tool call was interrupted before it produced a result.]";

function sanitizeCodexCallId(rawCallId) {
  if (typeof rawCallId !== "string" || !rawCallId) return clampResponsesCallId(rawCallId);
  // Codex IDs may append an item suffix after `|` or newline. Call and result
  // records can carry different suffixes; correlation uses the shared prefix.
  const separator = rawCallId.search(/[\n|]/);
  const base = separator > 0 ? rawCallId.slice(0, separator) : separator === 0 ? rawCallId.slice(1) : rawCallId;
  const sanitized = base.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+$/, "");
  if (sanitized && sanitized.length <= MAX_RESPONSES_CALL_ID_LEN && sanitized === base) return sanitized;
  const hash = createHash("sha256").update(base || rawCallId).digest("hex").slice(0, 12);
  const prefix = sanitized || "call";
  return `${prefix.slice(0, MAX_RESPONSES_CALL_ID_LEN - hash.length - 1)}_${hash}`;
}

function repairCodexToolCallPairs(input) {
  if (!Array.isArray(input)) return input;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (CODEX_TOOL_CALL_TYPES.has(item.type) || CODEX_TOOL_OUTPUT_TYPES.has(item.type)) {
      item.call_id = sanitizeCodexCallId(item.call_id);
    }
  }

  const callKinds = new Map();
  const outputKinds = new Map();
  for (const item of input) {
    const callId = typeof item?.call_id === "string" ? item.call_id : null;
    if (!callId) continue;
    const callKind = CODEX_TOOL_CALL_TYPES.get(item.type);
    const outputKind = CODEX_TOOL_OUTPUT_TYPES.get(item.type);
    if (callKind) callKinds.set(callId, callKind);
    if (outputKind) outputKinds.set(callId, outputKind);
  }

  const repaired = [];
  for (const item of input) {
    const callId = typeof item?.call_id === "string" ? item.call_id : null;
    const callKind = CODEX_TOOL_CALL_TYPES.get(item?.type);
    const outputKind = CODEX_TOOL_OUTPUT_TYPES.get(item?.type);

    if (outputKind && callId && callKinds.get(callId) !== outputKind) {
      let output = "";
      try {
        output = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
      } catch {
        output = String(item.output ?? "");
      }
      if (output.length > CODEX_ORPHAN_OUTPUT_LIMIT) output = `${output.slice(0, CODEX_ORPHAN_OUTPUT_LIMIT)}\n...[truncated]`;
      const name = typeof item.name === "string" ? item.name : "tool";
      repaired.push({
        type: RESPONSES_ITEM.MESSAGE,
        role: ROLE.ASSISTANT,
        content: `[Previous ${name} result; call_id=${callId}]: ${output}`,
      });
      continue;
    }
    if (callKind && callId && outputKinds.get(callId) !== callKind) {
      if (callKind === "computer") {
        repaired.push({
          type: RESPONSES_ITEM.MESSAGE,
          role: ROLE.ASSISTANT,
          content: `[Computer call interrupted before a screenshot was recorded; call_id=${callId}]`,
        });
      } else {
        repaired.push(item, {
          type: callKind === "custom" ? RESPONSES_ITEM.CUSTOM_TOOL_CALL_OUTPUT : RESPONSES_ITEM.FUNCTION_CALL_OUTPUT,
          call_id: callId,
          output: CODEX_INTERRUPTED_TOOL_OUTPUT,
        });
      }
      continue;
    }
    repaired.push(item);
  }
  return repaired;
}

// Flatten Chat-Completions tool shape into Responses flat format + filter unsupported tools
function normalizeCodexTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  // Codex's schema validator has no Unicode property escapes; a `pattern`
  // carrying `\p{...}` 400s the whole request on every account (#3922).
  const patternStats = { removed: 0 };
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const type = typeof tool.type === "string" ? tool.type : "";
    if (type === "namespace") {
      if (Array.isArray(tool.tools)) {
        for (const st of tool.tools) {
          const n = typeof st?.name === "string" ? st.name.trim().slice(0, 128) : "";
          if (n) validNames.add(n);
          if (st?.parameters && typeof st.parameters === "object") {
            st.parameters = stripCodexUnsupportedPatterns(st.parameters, patternStats);
          }
        }
      }
      return true;
    }
    if (type !== "function") {
      if (CODEX_PASSTHROUGH_TOOL_TYPES.has(type)) return true;
      if (!type || tool.function || typeof tool.name === "string") return false;
      return CODEX_HOSTED_TOOL_TYPES.has(type);
    }
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    const parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    const strict = typeof tool.strict === "boolean" ? tool.strict : fn?.strict;
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, 128);
    if (description) tool.description = description;
    tool.parameters = stripCodexUnsupportedPatterns(parameters, patternStats);
    if (typeof strict === "boolean") tool.strict = strict;
    validNames.add(name);
    return true;
  });
  if (patternStats.removed > 0) {
    dbg("CODEX", `stripped ${patternStats.removed} unsupported tool schema pattern(s)`);
  }
  // Drop tool_choice if it references an unknown function name
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Resolve prompt-cache session id: client session → assistant-text-hash → workspaceId → connection
function resolveCacheSessionId(body, credentials) {
  return resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.connectionId,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "codex"
  });
}

function normalizeReasoningEffort(model, value) {
  const supportedLevels = getThinkingLevels("codex", model);
  if (supportedLevels?.includes(value)) return value;
  if (isCodexResponsesLiteModel(model) && (value === "none" || value === "minimal")) return "low";
  if (value === "ultra" && supportedLevels?.includes("max")) return "max";
  if (value === "max" || value === "ultra") return "xhigh";
  return value;
}

function findNestedMessage(value, depth = 0) {
  if (!value || depth > 6 || typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (typeof value.message === "string" && value.message.trim()) return value.message;
  if (typeof value.error?.message === "string" && value.error.message.trim()) return value.error.message;
  if (typeof value.response?.error?.message === "string" && value.response.error.message.trim()) return value.response.error.message;
  for (const child of Object.values(value)) {
    const found = findNestedMessage(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function inspectCodexSseEvent(block) {
  let eventName = "";
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return null;

  const rawData = dataLines.join("\n");
  let payload;
  try {
    payload = JSON.parse(rawData);
  } catch {
    payload = null;
  }

  const eventType = eventName || payload?.type;
  if (CODEX_SSE_USER_OUTPUT_EVENTS.has(eventType)
    || (eventType === "response.output_item.added" && CODEX_TOOL_CALL_TYPES.has(payload?.item?.type))) {
    return { userOutput: true };
  }

  const isErrorEvent = eventName === "error" || payload?.type === "error";
  const isFailedEvent = eventName === "response.failed" || payload?.type === "response.failed";
  const error = isErrorEvent
    ? payload?.error ?? payload?.response?.error ?? payload ?? rawData
    : isFailedEvent
      ? payload?.response?.error ?? payload?.error
      : payload?.error ?? payload?.response?.error;
  if (!error) return null;

  const errorText = (typeof error === "string" ? error : JSON.stringify(error)).toLowerCase();
  const accountFallback = CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS.find((pattern) => errorText.includes(pattern));
  const retry = CODEX_SSE_RETRY_PATTERNS.find((pattern) => errorText.includes(pattern));
  if (!accountFallback && !retry) return null;

  const matched = accountFallback || retry;
  return {
    matched,
    accountFallback: !!accountFallback,
    message: (typeof error === "object" && findNestedMessage(error)) || (typeof error === "string" ? error : matched),
  };
}

function findCodexSseSignal(text, includeIncomplete = false) {
  const blocks = text.split(/\r?\n\r?\n/);
  if (!includeIncomplete && !text.endsWith("\n\n")) blocks.pop();
  for (const block of blocks) {
    if (!block.trim()) continue;
    const signal = inspectCodexSseEvent(block);
    if (signal) return signal;
  }
  return null;
}

function codexSseErrorResponse(status, message) {
  return new Response(JSON.stringify({
    error: {
      message,
      type: status >= 500 ? "server_error" : "invalid_request_error",
      code: status === HTTP_STATUS.SERVICE_UNAVAILABLE ? "service_unavailable" : "upstream_error",
    }
  }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Codex Executor - handles OpenAI Codex API (Responses API format)
 * Automatically injects default instructions if missing
 */
export class CodexExecutor extends BaseExecutor {
  constructor() {
    super("codex", PROVIDERS.codex);
    this._currentSessionId = null;
  }

  /**
   * Override headers to add codex-specific identity headers.
   * transformRequest runs BEFORE buildHeaders, sets this._currentSessionId.
   */
  buildHeaders(credentials, stream = true, _url = null, model = null, body = null) {
    const headers = super.buildHeaders(credentials, stream);
    if (isCodexResponsesLiteModel(model && getModelUpstreamId("cx", model)) && !body?.tools?.some?.(tool => tool?.type === "web_search")) {
      headers["x-openai-internal-codex-responses-lite"] = "true";
    }
    headers["session_id"] = this._currentSessionId || credentials?.connectionId || "default";
    // Identify client type to Codex backend (matches official codex CLI)
    if (!headers["originator"]) headers["originator"] = "codex_cli_rs";
    const requestModel = body?.model || getModelUpstreamId("cx", model || "");
    if (requestModel) {
      headers["x-codex-routing-hint"] = `model=${requestModel}${body?.service_tier ? `;tier=${body.service_tier}` : ""}`;
    }
    // Account/workspace binding header — required when multiple Codex accounts
    // are configured. OAuth import stores ChatGPT account ID as chatgptAccountId;
    // older/custom rows may use workspaceId/accountId. Prefer explicit workspaceId
    // but fall back to chatgptAccountId so requests don't cross-bind to the wrong
    // OpenAI account and surface as token_invalid after adding another account.
    const accountId =
      credentials?.providerSpecificData?.workspaceId ||
      credentials?.providerSpecificData?.chatgptAccountId ||
      credentials?.providerSpecificData?.accountId;
    if (typeof accountId === "string" && accountId && !headers["ChatGPT-Account-ID"]) {
      headers["ChatGPT-Account-ID"] = accountId;
    }
    return headers;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null, body = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return body?._compact ? `${base}/compact` : base;
  }

  async refreshCredentials(credentials, log) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("codex", credentials, log);
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials("codex", credentials);
  }

  /**
   * Prefetch remote image URLs and inline them as base64 data URIs.
   * Runs before execute() because Codex backend cannot fetch remote images.
   * Mutates body.input in place.
   */
  async prefetchImages(body) {
    if (!Array.isArray(body?.input)) return;
    for (const item of body.input) {
      if (!Array.isArray(item.content)) continue;
      const pending = item.content.map(async (content) => {
        const nativeImage = content?.type === "input_image";
        if (!nativeImage && content?.type !== "image_url") return content;
        const url = typeof content.image_url === "string" ? content.image_url : content.image_url?.url;
        if (!url) return content;
        const detail = content.detail || content.image_url?.detail || "auto";
        const imageUrl = url.startsWith("data:")
          ? url
          : (await fetchImageAsBase64(url, { timeoutMs: 15000 }))?.url || url;
        return nativeImage
          ? { ...content, image_url: imageUrl, detail }
          : { type: "input_image", image_url: imageUrl, detail };
      });
      item.content = await Promise.all(pending);
    }
  }

  async execute(args) {
    const input = args.body?.input;
    const imgCount = Array.isArray(input)
      ? input.reduce((n, item) => n + (Array.isArray(item.content) ? item.content.filter(content => content?.type === "image_url" || content?.type === "input_image").length : 0), 0)
      : 0;
    const inputLen = Array.isArray(input) ? input.length : 0;
    dbg("CODEX", `execute start | inputItems=${inputLen} | images=${imgCount} | sessionId=${this._currentSessionId || "pending"}`);
    await this.prefetchImages(args.body);

    // Retry loop for SSE-level overloaded errors (200 OK body contains event: error)
    // Reuses 503 retry config — same semantic: upstream temporarily unavailable
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[503]);
    let attempt = 0;
    const isCompact = args.body?._compact === true;
    while (true) {
      // transformRequest consumes the marker; restore it before retries so they
      // stay on the same endpoint.
      if (isCompact) args.body._compact = true;
      const result = await super.execute(args);
      const peek = await this._peekSseTransientError(result.response);
      if (!peek.matched) {
        // Replace body with re-assembled stream (prefix bytes already read + rest)
        if (peek.replacementBody) {
          result.response = new Response(peek.replacementBody, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          });
        }
        return result;
      }
      if (peek.accountFallback) {
        args.log?.warn?.("RETRY", `CODEX | SSE account fallback "${peek.message}"`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || CODEX_MODEL_CAPACITY_MESSAGE);
        return result;
      }
      if (attempt >= attempts) {
        args.log?.warn?.("RETRY", `CODEX | SSE overloaded "${peek.matched}" — retries exhausted (${attempt}/${attempts})`);
        result.response = codexSseErrorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, peek.message || peek.matched);
        return result;
      }
      attempt++;
      args.log?.debug?.("RETRY", `CODEX | SSE "${peek.matched}" retry ${attempt}/${attempts} after ${delayMs / 1000}s`);
      dbg("CODEX", `SSE overloaded "${peek.matched}" → retry ${attempt}/${attempts} in ${delayMs}ms`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  // Peek first N bytes of SSE body to detect structured transient error events.
  // Returns { matched, message, accountFallback, replacementBody }.
  // Caller must use replacementBody when no error matched (original body has been read).
  async _peekSseTransientError(response) {
    if (!response || !response.ok || !response.body) return { matched: null, message: null, accountFallback: false, replacementBody: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let text = "";
    let signal = null;
    try {
      while (text.length < CODEX_SSE_PEEK_BYTES) {
        const { done, value } = await reader.read();
        if (done) {
          text += decoder.decode();
          signal = findCodexSseSignal(text, true);
          break;
        }
        chunks.push(value);
        text += decoder.decode(value, { stream: true });
        signal = findCodexSseSignal(text);
        if (signal) break;
      }
    } catch (e) {
      dbg("CODEX", `peek read error: ${e.message}`);
    }

    if (signal?.matched) {
      try { await reader.cancel(); } catch { /* noop */ }
      try { reader.releaseLock(); } catch { /* noop */ }
      return { ...signal, replacementBody: null };
    }

    reader.releaseLock();

    // Re-assemble stream: prefix chunks already read + remaining upstream body.
    const upstream = response.body;
    let upstreamReader = null;
    const replacementBody = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        upstreamReader = upstream.getReader();
      },
      async pull(controller) {
        try {
          const { done, value } = await upstreamReader.read();
          if (done) { controller.close(); return; }
          controller.enqueue(value);
        } catch (e) { controller.error(e); }
      },
      cancel(reason) {
        try { upstreamReader?.cancel(reason); } catch { /* noop */ }
      },
    });
    return { matched: null, message: null, accountFallback: false, replacementBody };
  }

  // Parse Codex usage_limit_reached to extract precise resetsAtMs; fallback to default otherwise
  parseError(response, bodyText) {
    if (response.status === 429 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const err = json?.error;
        if (err?.type === "usage_limit_reached") {
          const now = Date.now();
          let resetsAtMs = null;
          if (typeof err.resets_at === "number" && err.resets_at > 0) {
            const ms = err.resets_at * 1000;
            if (ms > now) resetsAtMs = ms;
          }
          if (!resetsAtMs && typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
            resetsAtMs = now + err.resets_in_seconds * 1000;
          }
          if (resetsAtMs) {
            return { status: 429, message: err.message || bodyText, resetsAtMs };
          }
        }
      } catch { /* fall through to default */ }
    }
    return super.parseError(response, bodyText);
  }

  /**
   * Transform request before sending - inject default instructions if missing.
   * Image fetching is handled separately in prefetchImages() so this stays sync.
   */
  transformRequest(model, body, stream, credentials) {
    // The compact marker is consumed by buildUrl before this transform runs.
    delete body._compact;
    // Resolve conversation-stable session_id (priority: body → assistant-text → workspace → machine)
    this._currentSessionId = resolveCacheSessionId(body, credentials);
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;
    body.input = repairCodexToolCallPairs(body.input);
    const upstreamModel = getModelUpstreamId("cx", body.model || model);
    // Register hosted search before choosing transport; Lite cannot execute it.
    const autoWebSearch = body._autoCodexWebSearch === true;
    delete body._autoCodexWebSearch;
    if (autoWebSearch && !body.tools?.some?.(tool => tool?.type === "web_search")) {
      body.tools = [...(Array.isArray(body.tools) ? body.tools : []), { type: "web_search" }];
    }
    // Hosted search cannot run from a Lite input prefix. When switching to
    // regular Responses, move all prefixed tools without duplicating definitions.
    let convertedLitePrefix = false;
    if (isCodexResponsesLiteModel(upstreamModel) && Array.isArray(body.input)
      && (body.tools?.some?.(tool => tool?.type === "web_search")
        || body.input.some(item => item?.type === "additional_tools" && item.tools?.some?.(tool => tool?.type === "web_search")))) {
      const tools = Array.isArray(body.tools) ? [...body.tools] : [];
      const seen = new Set(tools.map(tool => `${tool?.type}:${tool?.name || tool?.function?.name || ""}`));
      for (const item of body.input) {
        if (item?.type !== "additional_tools" || !Array.isArray(item.tools)) continue;
        for (const tool of item.tools) {
          const name = `${tool?.type}:${tool?.name || tool?.function?.name || ""}`;
          if (!seen.has(name)) { tools.push(tool); seen.add(name); }
        }
      }
      body.tools = tools;
      convertedLitePrefix = body.input.some(item => item?.type === "additional_tools");
      body.input = body.input.filter(item => item?.type !== "additional_tools");
    }
    const responsesLite = isCodexResponsesLiteModel(upstreamModel)
      && !body.tools?.some?.(tool => tool?.type === "web_search");

    // Ensure input is present and non-empty (Codex API rejects empty input)
    if (!body.input || (Array.isArray(body.input) && body.input.length === 0)) {
      body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }

    // Keep system prompts in body.input as role=developer so they stay in the cacheable prefix
    convertSystemToDeveloperRole(body);
    // Strip server-generated item IDs (rs_/fc_/resp_/msg_) — Codex /responses can't resolve when store=false
    stripStoredItemReferences(body, responsesLite);
    // Flatten function tools + drop unsupported types
    normalizeCodexTools(body);

    // Ensure streaming is enabled (Codex API requires it)
    body.stream = true;

    // If no instructions provided, inject default Codex instructions
    if (!responsesLite && !convertedLitePrefix && (!body.instructions || body.instructions.trim() === "")) {
      body.instructions = CODEX_DEFAULT_INSTRUCTIONS;
    }

    // Ensure store is false (Codex requirement)
    body.store = false;

    // Inject prompt_cache_key for stable Codex prompt caching
    if (!body.prompt_cache_key && this._currentSessionId) {
      body.prompt_cache_key = this._currentSessionId;
    }

    // Map virtual Codex review models to the upstream Codex model before suffix parsing.
    body.model = upstreamModel;

    if (responsesLite) {
      // Codex 0.155 carries tools and instructions as input prefix items.
      const input = Array.isArray(body.input) ? body.input : [body.input];
      const hasLitePrefix = input.some((item) => item?.type === "additional_tools");
      if (!hasLitePrefix) {
        const instructions = typeof body.instructions === "string" && body.instructions.trim()
          ? body.instructions : CODEX_DEFAULT_INSTRUCTIONS;
        const prefix = [{ type: "additional_tools", role: "developer", tools: Array.isArray(body.tools) ? body.tools : [] }];
        if (instructions) {
          prefix.push({ type: "message", role: "developer", content: [{ type: "input_text", text: instructions }] });
        }
        input.unshift(...prefix);
      }
      body.input = input;
      body.instructions = "";
      body.tools = null;
      body.tool_choice ||= "auto";
      body.parallel_tool_calls = false;
    } else {
      delete body.parallel_tool_calls;
    }

    // Extract thinking level from model name suffix
    // e.g., gpt-5.3-codex-high → high, gpt-5.3-codex → medium (default)
    const effortLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    let modelEffort = null;
    for (const level of effortLevels) {
      if (body.model.endsWith(`-${level}`)) {
        modelEffort = level;
        // Strip suffix from model name for actual API call
        body.model = body.model.replace(`-${level}`, '');
        break;
      }
    }

    // Priority: explicit reasoning.effort > reasoning_effort param > model suffix > default (medium)
    if (!body.reasoning) {
      const effort = normalizeReasoningEffort(body.model, body.reasoning_effort || modelEffort || (responsesLite ? 'medium' : 'low'));
      body.reasoning = responsesLite ? { effort } : { effort, summary: "auto" };
    } else {
      body.reasoning.effort = normalizeReasoningEffort(body.model, body.reasoning.effort);
      if (!responsesLite && !body.reasoning.summary) body.reasoning.summary = "auto";
    }
    if (responsesLite) body.reasoning.context = "all_turns";
    delete body.reasoning_effort;

    // Keep caller-requested response metadata while adding the encrypted reasoning
    // required for Codex multi-turn continuity.
    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== "none") {
      const include = Array.isArray(body.include) ? body.include : [];
      body.include = [...new Set([...include, "reasoning.encrypted_content"])];
    }

    // Remove unsupported parameters for Codex API
    delete body.temperature;
    delete body.top_p;
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.n;
    delete body.seed;
    delete body.max_tokens;
    delete body.max_completion_tokens;
    delete body.max_output_tokens; // Responses API clients send this but Codex rejects it
    delete body.user; // Cursor sends this but Codex doesn't support it
    delete body.prompt_cache_retention; // Cursor sends this but Codex doesn't support it
    delete body.metadata; // Cursor sends this but Codex doesn't support it
    delete body.stream_options; // Cursor sends this but Codex doesn't support it
    delete body.safety_identifier; // Droid CLI sends this but Codex doesn't support it
    delete body.previous_response_id; // store=false → backend can't resolve previous resp; avoid 404

    if (body.service_tier === "fast") body.service_tier = "priority";
    if (body.service_tier && body.service_tier !== "priority") delete body.service_tier;

    // Final allowlist filter — strip any unknown field that could trigger upstream "routing_unsupported"
    for (const k of Object.keys(body)) {
      if (!RESPONSES_API_ALLOWLIST.has(k)) delete body[k];
    }

    return body;
  }
}
