import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";

const OPENCODE_UA = "opencode/1.18.31 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14";
// Models served by /zen/v1/responses; every other model stays on /chat/completions.
const RESPONSES_MODELS = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);

// Models served by /zen/v1/messages (Anthropic Messages API).
const MESSAGES_MODELS = new Set([
  "union-alpha",
]);

let lastTime = 0;
let counter = 0;
function genId(prefix) {
  const now = Date.now();
  if (now !== lastTime) {
    lastTime = now;
    counter = 0;
  }
  counter++;
  const val = BigInt(now) * 0x1000n + BigInt(counter);
  const timeHex = Array.from({ length: 6 }, (_, i) => Number((val >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0")).join("");
  const rand = crypto.getRandomValues(new Uint8Array(14));
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  return `${prefix}_${timeHex}${Array.from(rand, b => chars[b % 62]).join("")}`;
}

function generateRequestId() {
  return genId("msg");
}

function generateSessionId() {
  return genId("ses");
}

function generateProjectId() {
  return crypto.randomBytes(20).toString("hex");
}

// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  const base = baseModelId(model);
  return RESPONSES_MODELS.has(base) || isMuseSparkModel(base);
}

function isMessagesModel(model) {
  const base = baseModelId(model);
  return MESSAGES_MODELS.has(base);
}

function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const clientSes = lower["x-opencode-session"];
  if (typeof clientSes === "string" && clientSes.startsWith("ses_")) return clientSes;
  return generateSessionId();
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
  const requestedEffort = typeof body.reasoning_effort === "string"
    ? body.reasoning_effort
    : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if ((effort === "max" || effort === "ultra") && supportedLevels?.length && !supportedLevels.includes(effort)) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._currentSessionId = null;
  }

  transformRequest(model, body, stream, credentials) {
    this._currentSessionId = resolveOpencodeSession(body, credentials);
    if (isResponsesModel(model)) {
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
    } else if (isMessagesModel(model)) {
      if (!body.max_tokens && !body.max_output_tokens) {
        body.max_tokens = 4096;
      }
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    if (isResponsesModel(model)) {
      return `${base}/zen/v1/responses`;
    }
    if (isMessagesModel(model)) {
      return `${base}/zen/v1/messages`;
    }
    return `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, url = "", model = "") {
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = lower["user-agent"] || "";
    const isOpencodeDownstream = downstreamUa.toLowerCase().includes("opencode");
    const isMessages = (url && url.endsWith("/messages")) || isMessagesModel(model);

    const rawProject = lower["x-opencode-project"];
    const project = (!rawProject || rawProject === "global") ? generateProjectId() : rawProject;

    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "x-api-key": "public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || "cli",
      "x-opencode-session": lower["x-opencode-session"] || this._currentSessionId || generateSessionId(),
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-project": project,
      "Accept": stream ? "text/event-stream" : "*/*",
    };

    if (isMessages) {
      headers["anthropic-version"] = "2023-06-01";
    }

    return headers;
  }
}
