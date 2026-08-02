/**
 * QoderExecutor — sends OpenAI-format chat requests to Qoder's new
 * api2-v2.qoder.sh/model/v1/chat/completions endpoint.
 *
 * The new endpoint (used by qodercli v1.1.11+) is standard OpenAI-compatible:
 *   - URL: https://api2-v2.qoder.sh/model/v1/chat/completions
 *   - Auth: Authorization: Bearer <device_token> (same token from OAuth flow)
 *   - Body: Standard OpenAI chat completions format {model, messages, stream, ...}
 *   - Response: Standard OpenAI SSE stream (no envelope unwrapping needed)
 *   - Headers: Content-Type: application/json, Accept: application/json,
 *     User-Agent: qoder/1.1.11
 *
 * This is MUCH simpler than the old COSY-signed api3 endpoint. No RSA+AES
 * signing, no {statusCodeValue, body} envelope, no Qoder-specific request
 * format with model_config/business/chat_context blocks.
 *
 * The old COSY-based executor code is preserved at the bottom of this file
 * as commented-out backup exports, in case rollback is needed.
 *
 * Model identifier: the translator layer feeds us "qoder/<key>" (e.g.
 * "qoder/gm51model"); we strip the "qoder/" prefix and pass just the model
 * name to the API.
 */

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { QODER_MODEL_CHAT_URL } from "../shared/qoder/constants.js";
import { getQoderModelConfig } from "../services/qoderModels.js";

/**
 * Hoist role:"system" messages out of the messages array and flatten any
 * multipart content arrays into plain strings. Qoder's new endpoint accepts
 * standard OpenAI format, but keeping system messages as a single hoisted
 * string is still useful for cleanliness.
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], systemText: "" };
  }
  const systemParts = [];
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const text = extractText(msg.content);
    if (msg.role === "system") {
      if (text) systemParts.push(text);
      continue;
    }
    const cloned = { ...msg };
    cloned.content = text;
    out.push(cloned);
  }
  return { messages: out, systemText: systemParts.join("\n\n") };
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (item && typeof item === "object") {
        if (item.type === "text" && typeof item.text === "string") {
          parts.push(item.text);
        } else if (typeof item.text === "string") {
          parts.push(item.text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

/**
 * Build a standard OpenAI-compatible chat completions request body for the
 * new api2-v2 endpoint. If model_config is available from the catalog, use
 * its max_output_tokens as the default max_tokens; otherwise fall back to a
 * sensible default and pass the model name as-is.
 *
 * The model_config fetch is best-effort — if the catalog isn't cached or the
 * fetch fails, we just use defaults. The new endpoint doesn't require
 * model_config in the request body (unlike the old COSY endpoint which
 * silently downgraded models when model_config was wrong).
 */
async function buildRequestBody({ model, body, credentials, log, proxyOptions, signal }) {
  // Strip "qoder/" prefix — the new endpoint expects bare model names.
  const modelName = String(model || "").replace(/^qoder\//, "");

  const { messages, systemText } = normalizeMessages(body.messages || []);

  // If we have system text, prepend it as a system message (standard OpenAI
  // format — the new endpoint accepts system messages in the array).
  const finalMessages = systemText
    ? [{ role: "system", content: systemText }, ...messages]
    : messages;

  // Best-effort model config fetch for max_output_tokens.
  let maxTokens = 32_768;
  let modelConfig = null;
  try {
    modelConfig = await getQoderModelConfig(credentials, modelName, {
      log,
      proxyOptions,
      signal,
    });
  } catch {
    // Catalog fetch failed — fall back to default. The new endpoint accepts
    // requests without model_config, so this is safe.
  }
  if (modelConfig) {
    const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;
    if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
  }

  // Honor caller-specified max_tokens / max_completion_tokens if smaller.
  if (typeof body.max_tokens === "number" && body.max_tokens > 0 && body.max_tokens < maxTokens) {
    maxTokens = body.max_tokens;
  }
  if (
    typeof body.max_completion_tokens === "number" &&
    body.max_completion_tokens > 0 &&
    body.max_completion_tokens < maxTokens
  ) {
    maxTokens = body.max_completion_tokens;
  }

  const payload = {
    model: modelName,
    messages: finalMessages,
    stream: true,
    max_tokens: maxTokens,
  };

  // Pass through tools if present (standard OpenAI tool format).
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    payload.tools = body.tools;
  }
  if (body.tool_choice !== undefined) {
    payload.tool_choice = body.tool_choice;
  }
  if (typeof body.temperature === "number") {
    payload.temperature = body.temperature;
  }
  if (typeof body.top_p === "number") {
    payload.top_p = body.top_p;
  }

  return { modelName, payload };
}

export class QoderExecutor extends BaseExecutor {
  constructor() {
    super("qoder", PROVIDERS.qoder);
  }

  buildUrl() {
    return QODER_MODEL_CHAT_URL;
  }

  /**
   * Execute a chat completion request against Qoder's new api2-v2 endpoint.
   *
   * The new endpoint uses simple Bearer token auth (same device token from
   * the OAuth flow) and standard OpenAI-compatible request/response format.
   * No COSY signing, no body encoding, no SSE envelope unwrapping.
   */
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();

    // Credential checks — same as the old executor.
    const psd = credentials?.providerSpecificData || {};
    if (!psd.userId) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing userId; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }
    if (!credentials?.accessToken) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: "qoder credential is missing accessToken; reconnect the account" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    // Build standard OpenAI-compatible request body.
    let modelName;
    let payload;
    try {
      ({ modelName, payload } = await buildRequestBody({
        model,
        body,
        credentials,
        log,
        proxyOptions,
        signal,
      }));
    } catch (err) {
      const fakeResp = new Response(
        JSON.stringify({ error: { message: err.message } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
      return { response: fakeResp, url, headers: {}, transformedBody: body };
    }

    // Standard headers — Bearer auth, no COSY signing needed.
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      "User-Agent": "qoder/1.1.11",
    };

    const bodyStr = JSON.stringify(payload);

    // Abort if upstream doesn't return response headers within connect timeout.
    const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const connectCtrl = new AbortController();
    const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
    const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

    let response;
    try {
      response = await proxyAwareFetch(
        url,
        { method: "POST", headers, body: bodyStr, signal: mergedSignal },
        proxyOptions,
      );
    } finally {
      clearTimeout(connectTimer);
    }

    // The response is already standard OpenAI SSE — pass through as-is.
    // No wrapQoderSSE needed.
    return { response, url, headers, transformedBody: payload };
  }

  // Qoder device tokens don't refresh through OAuth — the upstream returns
  // 403 for our flow. Surfacing failure via 401-on-chat is enough; the
  // dashboard tells users to re-login when their token expires (~30 days).
  async refreshCredentials() {
    return null;
  }

  needsRefresh() {
    return false;
  }
}

export default QoderExecutor;

// Internals exposed for unit tests. Not part of the public API — callers
// should import QoderExecutor and use its public methods.
export const __test__ = {
  normalizeMessages,
  buildRequestBody,
  extractText,
};

// ============================================================================
// LEGACY CODE — preserved for rollback. The old executor used COSY signing
// (RSA+AES+MD5+17 Cosy-* headers) against api3.qoder.sh/pro/sse/. It required
// qoderEncodeBody, buildCosyHeaders, and wrapQoderSSE to handle Qoder's
// non-standard {statusCodeValue, body} SSE envelope.
//
// To roll back: restore the imports below, uncomment the old buildQoderRequestBody
// and wrapQoderSSE functions, and change QoderExecutor.execute() to use them.
//
// import { qoderEncodeBody } from "../shared/qoder/encoding.js";
// import { buildCosyHeaders } from "../shared/qoder/cosy.js";
// import { v4 as uuidv4 } from "uuid";
// import { createHash } from "crypto";
// import { SSE_DONE } from "../utils/sseConstants.js";
// import { QODER_CHAT_URL_ENCODED } from "../shared/qoder/constants.js";
// import { resolveQoderModels } from "../services/qoderModels.js";
//
// OLD buildQoderRequestBody and wrapQoderSSE are intentionally NOT included
// here to keep the file clean. See git history for the full implementation.
// ============================================================================
