import crypto from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../translator/formats/responsesApi.js";

const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeGoSession";
const MAX_SESSION_LENGTH = 256;

const USER_AGENT_FIELD = "_opencodeGoUserAgent";
const DEFAULT_CODING_AGENT_UA = "9router-coding-agent/1.0";
const MAX_UA_LENGTH = 256;

const KNOWN_CODING_AGENTS = [
  "opencode",
  "claude-cli",
  "claude-code",
  "claude",
  "cursor",
  "cline",
  "roo-cline",
  "roo-code",
  "aider",
  "windsurf",
  "continue",
  "codex",
  "gemini-cli",
  "deepseek-tui",
  "copilot",
  "githubcopilot",
  "trae",
  "zed",
  "void",
  "bolt",
  "swe-agent",
  "devin",
];

const GENERIC_UA_REGEX = /^(curl|wget|python-requests|requests|python-urllib|urllib|urllib3|aiohttp|httpx|axios|node-fetch|undici|got|superagent|okhttp|go-http-client|apache-httpclient|postmanruntime|insomnia|thunder[ -]?client|bun|rest-client|faraday|dart:io|java|req|wukong|fetch|openai|anthropic|langchain|llamaindex|litellm|google-genai|google-api|semantic-kernel|autogen|mozilla|chrome|safari|webkit|open-sse)($|[\s\/\(;_:,-])/i;

function extractHeader(headers, headerName) {
  if (!headers || typeof headers !== "object") return null;
  const target = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === "string") {
      return value.trim();
    }
  }
  return null;
}

function isCodingAgentUserAgent(ua) {
  if (!ua || typeof ua !== "string") return false;
  const lower = ua.toLowerCase();
  for (const agent of KNOWN_CODING_AGENTS) {
    if (lower.includes(agent)) return true;
  }
  return /\b(agent|coder|coding)\b/i.test(lower) ||
         /-(agent|coder|coding)/i.test(lower) ||
         /_(agent|coder|coding)/i.test(lower);
}

function isGenericUserAgent(ua) {
  if (!ua || typeof ua !== "string") return true;
  const trimmed = ua.trim();
  if (!trimmed) return true;
  if (isCodingAgentUserAgent(trimmed)) return false;
  return GENERIC_UA_REGEX.test(trimmed);
}

function syntheticUserAgent(clientTool) {
  if (clientTool && typeof clientTool === "string") {
    const normalized = clientTool.trim().toLowerCase();
    if (normalized === "claude") return "claude-cli/1.0";
    if (normalized === "codex") return "codex-tui/1.0";
    if (normalized === "gemini-cli") return "gemini-cli/1.0";
    if (normalized === "github-copilot") return "github-copilot/1.0";
    if (normalized === "deepseek-tui") return "deepseek-tui/1.0";
    if (normalized === "antigravity") return "antigravity-agent/1.0";
    return `${normalized}-agent/1.0`;
  }
  return DEFAULT_CODING_AGENT_UA;
}

function resolveOpencodeGoUserAgent(headers, clientTool) {
  const downstreamUa = extractHeader(headers, "user-agent");
  if (downstreamUa && !isGenericUserAgent(downstreamUa)) {
    return downstreamUa.slice(0, MAX_UA_LENGTH);
  }
  return syntheticUserAgent(clientTool);
}

const RESPONSES_BASE_URL = "https://opencode.ai/zen/go/v1/responses";
const MAX_TOOL_NAME_LEN = 128;

function normalizeSession(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

function nativeSession(headers) {
  const val = extractHeader(headers, SESSION_HEADER);
  return normalizeSession(val);
}

function translatedSession(sessionId, clientTool) {
  const digest = crypto
    .createHash("sha256")
    .update(`opencode-go\0${clientTool || "generic"}\0${sessionId}`)
    .digest("hex")
    .slice(0, 32);
  return `ses_${digest}`;
}

// Strip the thinking suffix "model(level)" so checks hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  return isMuseSparkModel(baseModelId(model));
}

// Flatten Chat Completions tool declarations into the Responses flat shape and
// drop hosted/nameless tools the /responses endpoint rejects.
function normalizeResponsesTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    let parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    // Mirror the request translator: {type:"object"} without properties is rejected
    // by strict Responses backends, so fill in the empty properties map.
    if (parameters.type === "object" && !parameters.properties) parameters = { ...parameters, properties: {} };
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, MAX_TOOL_NAME_LEN);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Last line of defense for native Responses clients (sourceFormat === targetFormat
// skips translation): coerce items in place so malformed tool payloads 400 here
// with a clear shape instead of upstream as InputValidationError.
function sanitizeResponsesItems(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    if (item.type === "function_call") {
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") return false;
      item.name = item.name.trim().slice(0, MAX_TOOL_NAME_LEN);
      item.call_id = clampResponsesCallId(item.call_id);
      item.arguments = coerceResponsesArguments(item.arguments);
      return true;
    }
    if (item.type === "function_call_output") {
      item.call_id = clampResponsesCallId(item.call_id);
      item.output = coerceResponsesOutput(item.output);
      return true;
    }
    return true;
  });
}

export class OpenCodeGoExecutor extends DefaultExecutor {
  constructor() {
    super("opencode-go");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Muse Spark lives on /responses even when a stale runtimeTransport leaks in.
    if (isResponsesModel(model)) return RESPONSES_BASE_URL;
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  prepareRequestCredentials({ body, credentials, providerSessionId, clientTool } = {}) {
    const sourceCredentials = credentials || {};
    const rawHeaders = sourceCredentials.rawHeaders;
    const native = nativeSession(rawHeaders);
    const resolved = normalizeSession(providerSessionId) || resolveSessionId({
      headers: rawHeaders,
      body,
      connectionId: sourceCredentials.connectionId,
      scope: "opencode-go",
    });
    const userAgent = resolveOpencodeGoUserAgent(rawHeaders, clientTool);

    return {
      ...sourceCredentials,
      [SESSION_FIELD]: native || translatedSession(resolved, clientTool),
      [USER_AGENT_FIELD]: userAgent,
    };
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    return super.execute({ ...args, credentials });
  }

  buildHeaders(credentials, stream = true, url, model) {
    const headers = super.buildHeaders(credentials || {}, stream, url, model);
    let prepared = credentials;
    if (!prepared?.[SESSION_FIELD] || !prepared?.[USER_AGENT_FIELD]) {
      prepared = this.prepareRequestCredentials({ credentials });
    }

    headers[SESSION_HEADER] = prepared[SESSION_FIELD];
    delete headers["user-agent"];
    headers["User-Agent"] = prepared[USER_AGENT_FIELD];
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const out = super.transformRequest(model, body);
    if (!isResponsesModel(model || body?.model)) return out;
    const normalized = normalizeResponsesInput(out.input);
    if (normalized) out.input = normalized;
    if (!Array.isArray(out.input) || out.input.length === 0) {
      out.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
    }
    // Responses names the output cap max_output_tokens, not max_tokens.
    if (out.max_output_tokens === undefined) {
      if (out.max_completion_tokens !== undefined) out.max_output_tokens = out.max_completion_tokens;
      else if (out.max_tokens !== undefined) out.max_output_tokens = out.max_tokens;
    }
    delete out.max_tokens;
    delete out.max_completion_tokens;
    if (out.reasoning_effort !== undefined && out.reasoning === undefined) {
      out.reasoning = { effort: out.reasoning_effort, summary: "auto" };
    }
    if (out.reasoning && typeof out.reasoning === "object" && !Array.isArray(out.reasoning)) {
      if (!out.reasoning.summary) out.reasoning.summary = "auto";
    }
    delete out.reasoning_effort;
    out.stream = true;
    out.store = false;
    normalizeResponsesTools(out);
    sanitizeResponsesItems(out);
    return out;
  }
}
