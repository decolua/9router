import { createHmac, createHash } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { HTTP_STATUS, DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";

const DEFAULT_REGION = "us-east-1";

// ─── AWS SigV4 helpers ────────────────────────────────────────────────────────

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256Raw(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function hmacSha256Hex(key, data) {
  return createHmac("sha256", key).update(data).digest("hex");
}

function deriveSigningKey(secretAccessKey, date, region, service) {
  const kDate    = hmacSha256Raw(`AWS4${secretAccessKey}`, date);
  const kRegion  = hmacSha256Raw(kDate, region);
  const kService = hmacSha256Raw(kRegion, service);
  return hmacSha256Raw(kService, "aws4_request");
}

/**
 * URI-encode a single path segment per SigV4 spec.
 * Encodes everything except unreserved chars: A-Z a-z 0-9 - _ . ~
 * This is stricter than encodeURIComponent (which leaves ! ' ( ) * unencoded).
 */
function uriEncodeSegment(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Build the canonical URI for SigV4 from a URL pathname.
 * Per AWS spec: decode the path first, then re-encode each segment.
 * This avoids double-encoding when the URL already has %3A etc.
 */
function buildCanonicalUri(pathname) {
  return pathname
    .split("/")
    .map(segment => segment === "" ? "" : uriEncodeSegment(decodeURIComponent(segment)))
    .join("/") || "/";
}

/**
 * Sign an HTTP request with AWS SigV4.
 * Returns an updated headers object that includes Authorization + x-amz-* headers.
 */
function signRequest({ method, url, headers = {}, body = "", credentials, service = "bedrock" }) {
  const { accessKeyId, secretAccessKey, sessionToken, region = DEFAULT_REGION } = credentials;

  const parsedUrl = new URL(url);
  const host      = parsedUrl.hostname;
  // Build canonical URI: decode then re-encode each segment (AWS SigV4 normalize step)
  const canonicalUri = buildCanonicalUri(parsedUrl.pathname);
  const query        = parsedUrl.search.slice(1); // without leading ?

  const now      = new Date();
  const datetime = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const date     = datetime.slice(0, 8);

  const bodyStr  = typeof body === "string" ? body : JSON.stringify(body);
  const bodyHash = sha256Hex(bodyStr);

  // Build canonical headers (must be sorted lowercase)
  const signHeaders = {
    "host":                 host,
    "x-amz-content-sha256": bodyHash,
    "x-amz-date":           datetime,
  };
  if (sessionToken) signHeaders["x-amz-security-token"] = sessionToken;

  const sortedKeys       = Object.keys(signHeaders).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${signHeaders[k]}\n`).join("");
  const signedHeadersStr = sortedKeys.join(";");

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,          // use properly encoded URI, not raw pathname
    query,
    canonicalHeaders,
    signedHeadersStr,
    bodyHash,
  ].join("\n");

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey    = deriveSigningKey(secretAccessKey, date, region, service);
  const signature     = hmacSha256Hex(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  return {
    ...headers,
    ...signHeaders,
    "Authorization": authorization,
  };
}

// ─── OpenAI → Bedrock Converse format ────────────────────────────────────────

/**
 * Convert a single OpenAI content value (string or array) to Bedrock content blocks.
 */
function openAIContentToBedrock(content) {
  if (typeof content === "string") {
    return [{ text: content }];
  }
  if (Array.isArray(content)) {
    const blocks = [];
    for (const part of content) {
      if (part.type === "text") {
        blocks.push({ text: part.text || "" });
      } else if (part.type === "image_url") {
        // Bedrock expects { image: { format, source: { bytes } } }
        const url = part.image_url?.url || "";
        if (url.startsWith("data:")) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            const mediaType = match[1]; // e.g. "image/jpeg"
            const bytes     = match[2];
            const format    = mediaType.split("/")[1] || "jpeg";
            blocks.push({ image: { format, source: { bytes } } });
          }
        } else {
          // URL-based image (not all models support it; use text fallback)
          blocks.push({ text: `[Image: ${url}]` });
        }
      }
    }
    return blocks.length > 0 ? blocks : [{ text: "" }];
  }
  return [{ text: String(content || "") }];
}

/**
 * Convert OpenAI messages to Bedrock Converse messages + system array.
 *
 * Key Bedrock rules:
 * 1. system messages → separate `system` array (not in messages)
 * 2. Multiple consecutive `tool` role messages MUST be merged into a
 *    single user message with multiple toolResult blocks.
 * 3. Messages must alternate user/assistant — consecutive same-role
 *    messages are merged.
 */
function convertMessages(messages) {
  const bedrockMessages = [];
  const systemBlocks    = [];

  // Helper: convert one OpenAI `tool` message to a Bedrock toolResult block
  function toolMsgToResultBlock(msg) {
    let resultContent;
    const raw = msg.content;

    if (raw == null || raw === "") {
      // Empty result → send success text
      resultContent = [{ text: "OK" }];
    } else if (typeof raw === "string") {
      // Try parsing as JSON object/array
      try {
        const parsed = JSON.parse(raw);
        // Bedrock only accepts objects (not primitives or arrays) as json type
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          resultContent = [{ json: parsed }];
        } else {
          // Primitive or array → convert to text
          resultContent = [{ text: typeof parsed === "string" ? parsed : JSON.stringify(parsed) }];
        }
      } catch {
        // Not JSON → plain text
        resultContent = [{ text: raw }];
      }
    } else if (typeof raw === "object" && !Array.isArray(raw)) {
      resultContent = [{ json: raw }];
    } else {
      resultContent = [{ text: String(raw) }];
    }

    return {
      toolResult: {
        toolUseId: msg.tool_call_id || "",
        content:   resultContent,
      },
    };
  }

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];

    // ── system ──────────────────────────────────────────────────────────────
    if (msg.role === "system") {
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      systemBlocks.push({ text });
      i++;
      continue;
    }

    // ── tool (results) ───────────────────────────────────────────────────────
    // Collect ALL consecutive tool messages into ONE user message so Bedrock
    // receives a single user turn with all toolResult blocks.
    if (msg.role === "tool") {
      const toolBlocks = [];
      while (i < messages.length && messages[i].role === "tool") {
        toolBlocks.push(toolMsgToResultBlock(messages[i]));
        i++;
      }
      bedrockMessages.push({ role: "user", content: toolBlocks });
      continue;
    }

    // ── user ─────────────────────────────────────────────────────────────────
    if (msg.role === "user") {
      const contentBlocks = openAIContentToBedrock(msg.content);
      bedrockMessages.push({ role: "user", content: contentBlocks });
      i++;
      continue;
    }

    // ── assistant ────────────────────────────────────────────────────────────
    if (msg.role === "assistant") {
      const contentBlocks = [];

      if (msg.content) {
        const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        if (text) contentBlocks.push({ text });
      }

      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let inputObj;
          try { inputObj = JSON.parse(tc.function?.arguments || "{}"); } catch { inputObj = {}; }
          contentBlocks.push({
            toolUse: {
              toolUseId: tc.id || `call_${Date.now()}`,
              name:      tc.function?.name || "",
              input:     inputObj,
            },
          });
        }
      }

      if (contentBlocks.length === 0) contentBlocks.push({ text: "" });
      bedrockMessages.push({ role: "assistant", content: contentBlocks });
      i++;
      continue;
    }

    i++; // skip unknown roles
  }

  return { bedrockMessages, systemBlocks };
}

/**
 * Convert OpenAI tools to Bedrock toolConfig.
 */
function convertTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return null;

  const bedrockTools = tools.map(t => ({
    toolSpec: {
      name:        t.function?.name || t.name || "",
      description: t.function?.description || t.description || "",
      inputSchema: { json: t.function?.parameters || {} },
    },
  }));

  return { tools: bedrockTools };
}

/**
 * Build the Bedrock Converse request body from an OpenAI-format body.
 */
function buildBedrockRequest(body) {
  const messages = body.messages || [];
  let { bedrockMessages, systemBlocks } = convertMessages(messages);

  // Bedrock requires the last message to be a user message.
  // Remove any trailing assistant messages (prefill) — Bedrock doesn't support them.
  while (bedrockMessages.length > 0 && bedrockMessages[bedrockMessages.length - 1].role === "assistant") {
    bedrockMessages.pop();
  }

  // Safety: ensure we have at least one message
  if (bedrockMessages.length === 0) {
    bedrockMessages.push({ role: "user", content: [{ text: "Continue" }] });
  }

  const inferenceConfig = {};
  if (body.max_tokens       != null) inferenceConfig.maxTokens       = body.max_tokens;
  if (body.temperature      != null) inferenceConfig.temperature      = body.temperature;
  if (body.top_p            != null) inferenceConfig.topP             = body.top_p;
  if (body.stop             != null) {
    inferenceConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  }

  const req = { messages: bedrockMessages };
  if (systemBlocks.length > 0) req.system = systemBlocks;
  if (Object.keys(inferenceConfig).length > 0) req.inferenceConfig = inferenceConfig;

  const toolConfig = convertTools(body.tools);
  if (toolConfig) req.toolConfig = toolConfig;

  return req;
}

// ─── Bedrock EventStream → OpenAI SSE ────────────────────────────────────────

/**
 * Parse one AWS EventStream frame from a Uint8Array.
 * Returns { headers, payload } or null on error.
 */
function parseEventFrame(data) {
  try {
    const view        = new DataView(data.buffer, data.byteOffset);
    const headersLen  = view.getUint32(4, false);

    const headers = {};
    let offset    = 12; // After prelude (totalLen + headersLen + preludeCRC = 12 bytes)
    const headerEnd = 12 + headersLen;

    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset];
      offset++;
      if (offset + nameLen > data.length) break;

      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen));
      offset += nameLen;

      const headerType = data[offset];
      offset++;

      if (headerType === 7) { // String
        const valueLen = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        if (offset + valueLen > data.length) break;
        headers[name] = new TextDecoder().decode(data.slice(offset, offset + valueLen));
        offset += valueLen;
      } else {
        break; // Unknown type – stop parsing headers
      }
    }

    const payloadStart = 12 + headersLen;
    const payloadEnd   = data.length - 4; // Exclude trailing CRC
    let payload        = null;

    if (payloadEnd > payloadStart) {
      const payloadStr = new TextDecoder().decode(data.slice(payloadStart, payloadEnd));
      if (payloadStr.trim()) {
        try { payload = JSON.parse(payloadStr); } catch { payload = { raw: payloadStr }; }
      }
    }

    return { headers, payload };
  } catch {
    return null;
  }
}

/**
 * Map Bedrock stopReason to OpenAI finish_reason.
 */
function mapStopReason(reason) {
  if (reason === "tool_use")  return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop"; // end_turn, etc.
}

/**
 * Transform the Bedrock ConverseStream (AWS EventStream binary) to an
 * OpenAI-compatible SSE text stream.
 *
 * Uses ReadableStream + getReader() instead of TransformStream.pipeThrough()
 * to avoid compatibility issues in the Next.js server environment.
 */
function transformBedrockStream(response, model) {
  const responseId = `chatcmpl-${Date.now()}`;
  const created    = Math.floor(Date.now() / 1000);
  const enc        = new TextEncoder();

  const state = {
    finishEmitted: false,
    roleEmitted:   false,
    hasToolCalls:  false,
    stopReason:    "stop",
    toolBlocks:    {},
    usage:         null,
  };

  function emitRole() {
    if (state.roleEmitted) return null;
    state.roleEmitted = true;
    return enc.encode(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);
  }

  function processFrame(payload, eventType) {
    const chunks = [];
    const p = payload;

    if (eventType === "messageStart") {
      const r = emitRole();
      if (r) chunks.push(r);
    }

    if (eventType === "contentBlockDelta" && p) {
      const r = emitRole(); if (r) chunks.push(r);
      const delta = p.delta || {};
      if (delta.text !== undefined) {
        chunks.push(enc.encode(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }] })}\n\n`));
      }
      if (delta.toolUse !== undefined) {
        const idx  = p.contentBlockIndex ?? 0;
        const tool = state.toolBlocks[idx];
        chunks.push(enc.encode(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: tool?.openaiIndex ?? 0, function: { arguments: delta.toolUse.input || "" } }] }, finish_reason: null }] })}\n\n`));
      }
    }

    if (eventType === "contentBlockStart" && p?.start?.toolUse) {
      const r = emitRole(); if (r) chunks.push(r);
      state.hasToolCalls = true;
      const idx       = p.contentBlockIndex ?? 0;
      const toolUse   = p.start.toolUse;
      const openaiIdx = Object.keys(state.toolBlocks).length;
      state.toolBlocks[idx] = { id: toolUse.toolUseId, name: toolUse.name, openaiIndex: openaiIdx };
      chunks.push(enc.encode(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: openaiIdx, id: toolUse.toolUseId, type: "function", function: { name: toolUse.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`));
    }

    if (eventType === "messageStop" && p) {
      state.stopReason    = mapStopReason(p.stopReason);
      state.finishEmitted = true;
      const finChunk = { id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: state.stopReason }] };
      if (state.usage) finChunk.usage = state.usage;
      chunks.push(enc.encode(`data: ${JSON.stringify(finChunk)}\n\n`));
    }

    if (eventType === "metadata" && p?.usage) {
      state.usage = {
        prompt_tokens:     p.usage.inputTokens     ?? 0,
        completion_tokens: p.usage.outputTokens    ?? 0,
        total_tokens:      p.usage.totalTokens     ?? (p.usage.inputTokens ?? 0) + (p.usage.outputTokens ?? 0),
      };
    }

    return chunks;
  }

  if (!response.body) {
    return new Response("data: [DONE]\n\n", {
      status: response.status,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const reader  = response.body.getReader();
  let   buffer  = new Uint8Array(0);

  const readable = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // flush: emit finish if not yet sent
            if (!state.finishEmitted) {
              const finChunk = { id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: state.stopReason || "stop" }] };
              if (state.usage) finChunk.usage = state.usage;
              controller.enqueue(enc.encode(`data: ${JSON.stringify(finChunk)}\n\n`));
            }
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          // Append chunk to buffer
          const next = new Uint8Array(buffer.length + value.length);
          next.set(buffer);
          next.set(value, buffer.length);
          buffer = next;

          // Parse all complete EventStream frames from buffer
          let iters = 0;
          let emittedAnything = false;
          while (buffer.length >= 16 && iters++ < 1000) {
            const view     = new DataView(buffer.buffer, buffer.byteOffset);
            const totalLen = view.getUint32(0, false);
            if (totalLen < 16 || totalLen > buffer.length) break;

            const frame = buffer.slice(0, totalLen);
            buffer      = buffer.slice(totalLen);

            const event = parseEventFrame(frame);
            if (!event) continue;

            const eventType = event.headers[":event-type"] || "";
            const outChunks = processFrame(event.payload, eventType);
            for (const c of outChunks) {
              controller.enqueue(c);
              emittedAnything = true;
            }
          }

          // Return control to let the consumer process what we emitted
          if (emittedAnything) return;
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    }
  });

  return new Response(readable, {
    status:  response.status,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}

/**
 * Convert non-streaming Bedrock Converse JSON response to a simulated SSE stream.
 */
async function bedrockJsonToSSEResponse(response, model) {
  const enc        = new TextEncoder();
  const responseId = `chatcmpl-${Date.now()}`;
  const created    = Math.floor(Date.now() / 1000);

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return new Response(`data: {"error":"Failed to parse Bedrock response"}\n\ndata: [DONE]\n\n`, {
      status: 500,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const msg        = data.output?.message || {};
  const content    = msg.content || [];
  const usage      = data.usage || {};
  const stopReason = mapStopReason(data.stopReason);

  const chunks = [];

  // Role chunk
  chunks.push(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`);

  // Content blocks
  const toolCalls = [];
  let toolIdx = 0;

  for (const block of content) {
    if (block.text) {
      // Emit text in one chunk
      chunks.push(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: block.text }, finish_reason: null }] })}\n\n`);
    }

    if (block.toolUse) {
      const argStr = JSON.stringify(block.toolUse.input || {});
      // Tool call header
      chunks.push(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIdx, id: block.toolUse.toolUseId, type: "function", function: { name: block.toolUse.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`);
      // Tool call arguments
      chunks.push(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index: toolIdx, function: { arguments: argStr } }] }, finish_reason: null }] })}\n\n`);
      toolIdx++;
    }

    if (block.reasoningContent?.text) {
      chunks.push(`data: ${JSON.stringify({ id: responseId, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { reasoning_content: block.reasoningContent.text }, finish_reason: null }] })}\n\n`);
    }
  }

  // Finish chunk with usage
  const finChunk = {
    id: responseId, object: "chat.completion.chunk", created, model,
    choices: [{ index: 0, delta: {}, finish_reason: stopReason }],
    usage: {
      prompt_tokens:     usage.inputTokens  || 0,
      completion_tokens: usage.outputTokens || 0,
      total_tokens:      usage.totalTokens  || (usage.inputTokens || 0) + (usage.outputTokens || 0),
    },
  };
  chunks.push(`data: ${JSON.stringify(finChunk)}\n\n`);
  chunks.push("data: [DONE]\n\n");

  const body = enc.encode(chunks.join(""));
  return new Response(body, {
    status:  200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

async function transformBedrockResponse(response, model) {
  const data       = await response.json();
  const msg        = data.output?.message || {};
  const content    = msg.content || [];
  const usage      = data.usage || {};
  const stopReason = mapStopReason(data.stopReason);

  let textContent = "";
  const toolCalls = [];

  for (const block of content) {
    if (block.text !== undefined) {
      textContent += block.text;
    } else if (block.toolUse) {
      toolCalls.push({
        id:       block.toolUse.toolUseId,
        type:     "function",
        function: {
          name:      block.toolUse.name,
          arguments: JSON.stringify(block.toolUse.input || {}),
        },
      });
    }
  }

  const choice = {
    index:         0,
    message:       { role: "assistant", content: textContent || null },
    finish_reason: stopReason,
  };
  if (toolCalls.length > 0) choice.message.tool_calls = toolCalls;

  const openaiBody = {
    id:      `chatcmpl-${Date.now()}`,
    object:  "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice],
    usage: {
      prompt_tokens:     usage.inputTokens  || 0,
      completion_tokens: usage.outputTokens || 0,
      total_tokens:      usage.totalTokens  || (usage.inputTokens || 0) + (usage.outputTokens || 0),
    },
  };

  return new Response(JSON.stringify(openaiBody), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── BedrockExecutor ──────────────────────────────────────────────────────────
//
// Uses bedrock-runtime OpenAI-compatible Chat Completions endpoint.
// Supports both Bearer token (Bedrock API key) and SigV4 (IAM credentials).
//
//   Bearer: https://bedrock-runtime.{region}.amazonaws.com/v1/chat/completions
//           Authorization: Bearer <bedrock-api-key>
//
//   SigV4:  https://bedrock-runtime.{region}.amazonaws.com/v1/chat/completions
//           AWS4-HMAC-SHA256 signed headers
//
// Model IDs (cross-region inference profiles, no date/version suffix):
//   us.anthropic.claude-sonnet-4-6
//   us.anthropic.claude-opus-4-6
//   us.amazon.nova-pro-v1:0
//   etc.

export class BedrockExecutor extends BaseExecutor {
  constructor() {
    super("bedrock", PROVIDERS.bedrock);
  }

  getAuthMode(credentials) {
    return credentials?.providerSpecificData?.accessKeyId ? "sigv4" : "bearer";
  }

  getRegion(credentials) {
    return credentials?.providerSpecificData?.region || DEFAULT_REGION;
  }

  extractAwsCredentials(credentials) {
    const psd = credentials?.providerSpecificData || {};
    return {
      accessKeyId:     psd.accessKeyId     || "",
      secretAccessKey: credentials?.apiKey || psd.secretAccessKey || "",
      sessionToken:    psd.sessionToken    || undefined,
      region:          psd.region          || DEFAULT_REGION,
    };
  }

  buildUrl(model, stream) {
    // Always use non-streaming /converse endpoint — avoids binary EventStream parsing
    // and client timeout issues with large tool call arguments (file creation, etc.)
    return `https://bedrock-runtime.${DEFAULT_REGION}.amazonaws.com/model/${model}/converse`;
  }

  buildRuntimeUrl(model, region) {
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${model}/converse`;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const authMode    = this.getAuthMode(credentials);
    const region      = this.getRegion(credentials);
    // Always use the non-streaming /converse endpoint for reliability.
    // We simulate SSE streaming from the JSON response ourselves.
    const url         = this.buildRuntimeUrl(model, region);
    const bedrockBody = buildBedrockRequest(body);
    const bodyStr     = JSON.stringify(bedrockBody);

    log?.debug?.("BEDROCK", `auth=${authMode} region=${region} model=${model}`);

    let headers;
    if (authMode === "bearer") {
      headers = { "Content-Type": "application/json", "Authorization": `Bearer ${credentials.apiKey}` };
    } else {
      headers = signRequest({
        method:      "POST",
        url,
        headers:     { "Content-Type": "application/json" },
        body:        bodyStr,
        credentials: this.extractAwsCredentials(credentials),
        service:     "bedrock",
      });
    }

    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config?.retry };
    let retryAttempts = 0;
    const maxRetries  = resolveRetryEntry(retryConfig[429])?.attempts || 0;

    while (true) {
      let response;
      try {
        response = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions);
      } catch (err) {
        throw err;
      }

      if (response.status === 429 && retryAttempts < maxRetries) {
        retryAttempts++;
        const { delayMs } = resolveRetryEntry(retryConfig[429]);
        log?.debug?.("RETRY", `Bedrock 429 retry ${retryAttempts}/${maxRetries} after ${delayMs}ms`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }

      if (!response.ok) {
        return { response, url, headers, transformedBody: bedrockBody };
      }

      // Convert the non-streaming JSON response to a simulated SSE stream.
      // This avoids binary EventStream parsing issues and client timeout problems
      // with large tool call arguments (e.g., file creation with big content).
      const transformed = await bedrockJsonToSSEResponse(response, model);
      return { response: transformed, url, headers, transformedBody: bedrockBody };
    }
  }
}

export default BedrockExecutor;
