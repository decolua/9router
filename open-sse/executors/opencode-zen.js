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
const SESSION_FIELD = "_opencodeZenSession";
const MAX_SESSION_LENGTH = 256;

const RESPONSES_BASE_URL = "https://opencode.ai/zen/v1/responses";
const MAX_TOOL_NAME_LEN = 128;
const OPENCODE_UA = "opencode/1.18.31";
export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Free-tier fingerprint (mirrors opencode executor, PR #4132): upstream 403s
// requests without the file-search quartet and without stream:true.
const OPENCODE_FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

function unstableRandom() {
  const bytes = crypto.randomBytes(14);
  let randomPart = "";
  for (let i = 0; i < 14; i++) {
    randomPart += BASE62_CHARS[bytes[i] % 62];
  }
  return randomPart;
}

export function generateSessionId(timestamp = Date.now()) {
  const current = BigInt(timestamp) * 0x1000n + 1n;
  const value = ~current;
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0")
  ).join("");
  return `ses_${time}${unstableRandom()}`;
}

export function generateRequestId(timestamp = Date.now()) {
  const current = BigInt(timestamp) * 0x1000n + 1n;
  const value = current;
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0")
  ).join("");
  return `msg_${time}${unstableRandom()}`;
}

export function translateSessionId(sessionId, clientTool = "") {
  if (typeof sessionId === "string" && OPENCODE_SESSION_RE.test(sessionId.trim())) {
    return sessionId.trim();
  }
  const digest = crypto
    .createHash("sha256")
    .update(`opencode\0${clientTool || "generic"}\0${sessionId || ""}`)
    .digest();
  const timeHex = digest.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) {
    randomPart += BASE62_CHARS[digest[i] % 62];
  }
  return `ses_${timeHex}${randomPart}`;
}

function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
  const raw = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
  return raw.trim();
}

function ensureChatFingerprintTools(body) {
  if (!body || typeof body !== "object") return;
  const present = new Set();
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      const name = toolNameOf(tool);
      if (name) present.add(name);
    }
  } else {
    body.tools = [];
  }
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (present.has(name)) continue;
    body.tools.push({
      type: "function",
      function: {
        name,
        description: `OpenCode built-in ${name} tool`,
        parameters: { type: "object", properties: {} },
      },
    });
    present.add(name);
  }
}

function ensureResponsesFingerprintTools(body) {
  if (!body || typeof body !== "object") return;
  const present = new Set();
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      const name = toolNameOf(tool);
      if (name) present.add(name);
    }
  } else {
    body.tools = [];
  }
  for (const name of OPENCODE_FINGERPRINT_TOOLS) {
    if (present.has(name)) continue;
    body.tools.push({
      type: "function",
      name,
      description: `OpenCode built-in ${name} tool`,
      parameters: { type: "object", properties: {} },
    });
    present.add(name);
  }
}

function normalizeSession(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

function nativeSession(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === SESSION_HEADER) {
      const normalized = normalizeSession(value);
      if (normalized && OPENCODE_SESSION_RE.test(normalized)) return normalized;
    }
  }
  return null;
}

function translatedSession(sessionId, clientTool) {
  return translateSessionId(sessionId, clientTool);
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
    // Strip prior-turn reasoning items: Muse Spark contributor models route to
    // an upstream Console backend where encrypted_content cannot be validated across
    // rotated accounts or sessions, causing 400 "reasoning encrypted_content was not issued to this caller".
    if (item.type === "reasoning") return false;
    delete item.encrypted_content;
    delete item.reasoning_encrypted_content;
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

export class OpenCodeZenExecutor extends DefaultExecutor {
  constructor() {
    super("opencode-zen");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // Muse Spark lives on /responses even when a stale runtimeTransport leaks in.
    if (isResponsesModel(model)) return RESPONSES_BASE_URL;
    return super.buildUrl(model, stream, urlIndex, credentials);
  }

  prepareRequestCredentials({ body, credentials, providerSessionId, clientTool } = {}) {
    const sourceCredentials = credentials || {};
    const native = nativeSession(sourceCredentials.rawHeaders);
    const resolved = normalizeSession(providerSessionId) || resolveSessionId({
      headers: sourceCredentials.rawHeaders,
      body,
      connectionId: sourceCredentials.connectionId,
      scope: "opencode-zen",
    });

    return {
      ...sourceCredentials,
      [SESSION_FIELD]: native || translatedSession(resolved, clientTool),
    };
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    return super.execute({ ...args, credentials });
  }

  buildHeaders(credentials, stream = true, url, model) {
    const headers = super.buildHeaders(credentials || {}, stream, url, model);
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;
    const downstreamUa = lower["user-agent"] || "";
    // Free-tier gate: spoof the official client UA.
    headers["User-Agent"] = hasValidOpencodeVersion(downstreamUa) ? downstreamUa : OPENCODE_UA;
    headers["x-opencode-client"] = lower["x-opencode-client"] || "desktop";
    const prepared = credentials?.[SESSION_FIELD];
    if (prepared) {
      headers[SESSION_HEADER] = prepared;
      return headers;
    }

    const fallback = this.prepareRequestCredentials({ credentials });
    headers[SESSION_HEADER] = fallback[SESSION_FIELD];
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const out = super.transformRequest(model, body);
    // Free-tier gate: upstream 403s stream:false even when everything else is valid.
    if (out && typeof out === "object") out.stream = true;
    if (!isResponsesModel(model || body?.model)) {
      ensureChatFingerprintTools(out);
      return out;
    }
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
    ensureResponsesFingerprintTools(out);
    normalizeResponsesTools(out);
    sanitizeResponsesItems(out);
    return out;
  }
}
