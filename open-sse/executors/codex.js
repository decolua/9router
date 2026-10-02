import { BaseExecutor } from "./base.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../config/codexInstructions.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { normalizeResponsesInput } from "../translator/formats/responsesApi.js";
import { fetchImageAsBase64 } from "../translator/concerns/image.js";
import { getModelUpstreamId, getProviderModels } from "../config/providerModels.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { DEFAULT_RETRY_CONFIG, HTTP_STATUS, resolveRetryEntry } from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { stripCodexUnsupportedPatterns } from "../utils/codexToolSchema.js";
import { recordRenamedToolNames } from "../utils/opencodeFingerprint.js";
import {
  RESPONSES_TOOL_NAME_MAX_LENGTH,
  allocateToolName,
  isValidToolName,
  sanitizeToolName,
} from "../utils/toolNameAliases.js";

// SSE error patterns inside 200-OK bodies. Some retry same account first; capacity rotates accounts.
const CODEX_SSE_RETRY_PATTERNS = ["server_is_overloaded", "service_unavailable_error"];
const CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS = ["selected model is at capacity", "model_at_capacity"];
const CODEX_SSE_USER_OUTPUT_PATTERNS = [
  "event: response.output_text.delta",
  "event: response.function_call_arguments.delta",
  '"type":"response.output_text.delta"',
  '"type":"response.function_call_arguments.delta"',
];
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

function codexToolName(tool) {
  if (tool?.type === "function") {
    if (typeof tool.name === "string") return tool.name;
    return typeof tool.function?.name === "string" ? tool.function.name : "";
  }
  return typeof tool?.name === "string" ? tool.name : "";
}

// Normalize the declarations that will be sent, then apply the same aliases to
// tool history and an explicit choice. Lite clients may already carry declarations
// in an additional_tools input prefix instead of body.tools.
function normalizeCodexTools(body, responsesLite) {
  const prefixed = responsesLite && Array.isArray(body.input)
    ? body.input.filter((item) => item?.type === "additional_tools" && Array.isArray(item.tools))
    : [];
  const containers = prefixed.length > 0 ? prefixed : [body];
  const declarations = containers.flatMap((container) => Array.isArray(container.tools) ? container.tools : []);
  const stableNames = new Set(declarations
    .filter((tool) => ["function", "custom", "namespace"].includes(tool?.type))
    .map(codexToolName)
    .filter((name) => isValidToolName(name, RESPONSES_TOOL_NAME_MAX_LENGTH)));
  const usedNames = new Set(stableNames);
  const topLevelAliases = new Map();
  const callableAliases = new Map();
  const childAliases = new Map();
  const ambiguousChildren = new Set();
  const toolNameMap = new Map();
  const validNames = new Set();
  // Codex's schema validator has no Unicode property escapes; a `pattern`
  // carrying `\p{...}` 400s the whole request on every account (#3922).
  const patternStats = { removed: 0 };

  const topLevelAlias = (rawName, callable) => {
    let alias = topLevelAliases.get(rawName);
    if (!alias) {
      alias = isValidToolName(rawName, RESPONSES_TOOL_NAME_MAX_LENGTH)
        ? rawName
        : allocateToolName(rawName, RESPONSES_TOOL_NAME_MAX_LENGTH, usedNames);
      topLevelAliases.set(rawName, alias);
    }
    if (callable) {
      callableAliases.set(rawName, alias);
      validNames.add(alias);
      if (alias !== rawName) toolNameMap.set(alias, rawName);
    }
    return alias;
  };

  for (const container of containers) {
    if (!Array.isArray(container.tools)) continue;
    container.tools = container.tools.filter((tool) => {
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
      const type = typeof tool.type === "string" ? tool.type : "";
      if (type === "namespace") {
        const rawName = codexToolName(tool);
        if (!rawName.trim()) return false;
        tool.name = topLevelAlias(rawName, false);
        const children = Array.isArray(tool.tools) ? tool.tools : [];
        const stableChildren = new Set(children
          .map((child) => child?.name)
          .filter((name) => isValidToolName(name, RESPONSES_TOOL_NAME_MAX_LENGTH)));
        const usedChildren = new Set(stableChildren);
        const assignedChildren = new Map();
        tool.tools = children.filter((child) => {
          if (!child || typeof child !== "object" || Array.isArray(child)) return false;
          const rawChildName = typeof child.name === "string" ? child.name : "";
          if (!rawChildName.trim()) return false;
          let alias = assignedChildren.get(rawChildName);
          if (!alias) {
            alias = isValidToolName(rawChildName, RESPONSES_TOOL_NAME_MAX_LENGTH)
              ? rawChildName
              : allocateToolName(rawChildName, RESPONSES_TOOL_NAME_MAX_LENGTH, usedChildren);
            assignedChildren.set(rawChildName, alias);
          }
          child.name = alias;
          validNames.add(alias);
          if (!ambiguousChildren.has(rawChildName)) {
            const previous = childAliases.get(rawChildName);
            if (previous && previous !== alias) {
              childAliases.delete(rawChildName);
              ambiguousChildren.add(rawChildName);
            } else {
              childAliases.set(rawChildName, alias);
            }
          }
          if (child.parameters && typeof child.parameters === "object") {
            child.parameters = stripCodexUnsupportedPatterns(child.parameters, patternStats);
          }
          return true;
        });
        return true;
      }
      if (type === "custom") {
        const rawName = codexToolName(tool);
        if (!rawName.trim()) return false;
        tool.name = topLevelAlias(rawName, true);
        return true;
      }
      if (type !== "function") {
        if (!type || tool.function || typeof tool.name === "string") return false;
        return CODEX_HOSTED_TOOL_TYPES.has(type);
      }
      const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
      const rawName = codexToolName(tool);
      if (!rawName.trim()) return false;
      const name = topLevelAlias(rawName, true);
      const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
      const parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
        ? tool.parameters
        : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
      for (const key of Object.keys(tool)) delete tool[key];
      tool.type = "function";
      tool.name = name;
      if (description) tool.description = description;
      tool.parameters = stripCodexUnsupportedPatterns(parameters, patternStats);
      return true;
    });
  }
  for (const [rawName, alias] of childAliases) {
    if (!callableAliases.has(rawName)) callableAliases.set(rawName, alias);
  }
  if (patternStats.removed > 0) {
    dbg("CODEX", `stripped ${patternStats.removed} unsupported tool schema pattern(s)`);
  }

  if (Array.isArray(body.input)) {
    body.input = body.input.map((item) => {
      if (!item || typeof item !== "object") return item;
      let modified = item;
      if ((item.type === "function_call" || item.type === "custom_tool_call") && typeof item.name === "string") {
        const name = callableAliases.get(item.name) || sanitizeToolName(item.name, RESPONSES_TOOL_NAME_MAX_LENGTH);
        if (name !== item.name) modified = { ...modified, name };
      }
      if (item.call && typeof item.call.name === "string") {
        const name = callableAliases.get(item.call.name) || sanitizeToolName(item.call.name, RESPONSES_TOOL_NAME_MAX_LENGTH);
        if (name !== item.call.name) modified = { ...modified, call: { ...item.call, name } };
      }
      return modified;
    });
  }

  // Keep explicit tool choices aligned with the declarations Codex will see.
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function" || body.tool_choice.type === "custom") {
      const rawName = typeof body.tool_choice.name === "string"
        ? body.tool_choice.name : body.tool_choice.function?.name;
      const alias = callableAliases.get(rawName);
      if (!alias || !validNames.has(alias)) {
        delete body.tool_choice;
      } else {
        body.tool_choice = { ...body.tool_choice, name: alias };
        delete body.tool_choice.function;
      }
    }
  }
  recordRenamedToolNames(body, toolNameMap);
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

function extractSseErrorMessage(text, fallback) {
  const exact = text?.match(/Selected model is at capacity\. Please try a different model\./i)?.[0];
  if (exact) return exact;

  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const message = findNestedMessage(JSON.parse(data));
      if (message) return message;
    } catch {
      // Ignore non-JSON SSE data lines.
    }
  }

  return fallback || CODEX_MODEL_CAPACITY_MESSAGE;
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

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const base = super.buildUrl(model, stream, urlIndex, credentials);
    return this._isCompact ? `${base}/compact` : base;
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
      const pending = item.content.map(async (c) => {
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

  async execute(args) {
    const imgCount = Array.isArray(args.body?.input) ? args.body.input.reduce((n, it) => n + (Array.isArray(it.content) ? it.content.filter(c => c.type === "image_url").length : 0), 0) : 0;
    const inputLen = Array.isArray(args.body?.input) ? args.body.input.length : 0;
    dbg("CODEX", `execute start | inputItems=${inputLen} | images=${imgCount} | sessionId=${this._currentSessionId || "pending"}`);
    if (imgCount > 0) {
      const t0 = Date.now();
      await this.prefetchImages(args.body);
      dbg("CODEX", `prefetchImages done | ${Date.now() - t0}ms`);
    } else {
      await this.prefetchImages(args.body);
    }

    // Retry loop for SSE-level overloaded errors (200 OK body contains event: error)
    // Reuses 503 retry config — same semantic: upstream temporarily unavailable
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const { attempts, delayMs } = resolveRetryEntry(retryConfig[503]);
    let attempt = 0;
    while (true) {
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

  // Peek first N bytes of SSE body to detect upstream transient errors.
  // Returns { matched: string|null, message: string|null, accountFallback: boolean, replacementBody: ReadableStream|null }.
  // Caller must use replacementBody when no error matched (original body has been read).
  async _peekSseTransientError(response) {
    if (!response || !response.ok || !response.body) return { matched: null, message: null, accountFallback: false, replacementBody: null };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let text = "";
    let matched = null;
    let accountFallback = false;
    try {
      while (text.length < CODEX_SSE_PEEK_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        text += decoder.decode(value, { stream: true });
        const lowerText = text.toLowerCase();
        const accountHit = CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS.find(p => lowerText.includes(p));
        if (accountHit) { matched = accountHit; accountFallback = true; break; }
        const retryHit = CODEX_SSE_RETRY_PATTERNS.find(p => lowerText.includes(p));
        if (retryHit) { matched = retryHit; break; }
        if (CODEX_SSE_USER_OUTPUT_PATTERNS.some(p => lowerText.includes(p))) break;
      }
    } catch (e) {
      dbg("CODEX", `peek read error: ${e.message}`);
    }

    if (matched) {
      try { await reader.cancel(); } catch { /* noop */ }
      try { reader.releaseLock(); } catch { /* noop */ }
      return { matched, message: extractSseErrorMessage(text, matched), accountFallback, replacementBody: null };
    }

    reader.releaseLock();

    // Re-assemble stream: prefix chunks + remaining upstream body
    const upstream = response.body;
    let upstreamReader = null;
    const replacementBody = new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
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
    this._isCompact = !!body._compact;
    delete body._compact;
    // Resolve conversation-stable session_id (priority: body → assistant-text → workspace → machine)
    this._currentSessionId = resolveCacheSessionId(body, credentials);
    // Convert string input to array format (Codex API requires input as array)
    const normalized = normalizeResponsesInput(body.input);
    if (normalized) body.input = normalized;
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
    normalizeCodexTools(body, responsesLite);

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

    // Include reasoning encrypted content (required by Codex backend for reasoning models)
    if (body.reasoning && body.reasoning.effort && body.reasoning.effort !== 'none') {
      body.include = ["reasoning.encrypted_content"];
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
