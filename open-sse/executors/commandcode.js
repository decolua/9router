import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";
import { SSE_DONE } from "../utils/sseConstants.js";

const INITIAL_INSPECTION_MAX_LINES = 32;
const INITIAL_INSPECTION_MAX_BYTES = 128 * 1024;

const METADATA_EVENTS = new Set([
  "start",
  "start-step",
  "reasoning-start",
  "reasoning-end",
  "text-start",
  "text-end",
  "provider-metadata",
  "message-metadata",
]);

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE → JSON) downstream handlers in
 * 9router can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials) {
    const { model: _rootModel, stream: _rootStream, ...request } = body;
    return request;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    let inBandRetries = 0;

    while (true) {
      const result = await super.execute(opts);
      if (!result?.response?.ok || !result.response.body) return result;

      const inspected = await inspectInitialResponse(result.response);
      if (!inspected.error) {
        result.response = wrapNdjsonAsOpenAISse(inspected.response, opts.model);
        return result;
      }

      const retry = this.config.retry?.[String(inspected.error.status)] || null;
      if (inspected.error.retryable && retry && inBandRetries < (retry.attempts || 0)) {
        inBandRetries++;
        if (retry.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, retry.delayMs));
        continue;
      }

      result.response = createCommandCodeErrorResponse(inspected.error);
      return result;
    }
  }
}

function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const json = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
  if (!json || json === "[DONE]") return null;
  try { return JSON.parse(json); } catch { return null; }
}

function normalizeError(event) {
  const details = event?.error && typeof event.error === "object" ? event.error : {};
  const rawStatus = details.statusCode ?? event?.statusCode;
  const status = Number.isInteger(Number(rawStatus)) ? Number(rawStatus) : 502;
  const rawMessage = details.message ?? event?.message ?? event?.error;
  const message = typeof rawMessage === "string"
    ? rawMessage
    : rawMessage
      ? JSON.stringify(rawMessage)
      : "Command Code upstream error";

  return {
    status,
    message,
    retryable: details.isRetryable === true || event?.isRetryable === true || status >= 500,
  };
}

async function inspectInitialResponse(response) {
  if (!response.body?.tee) return { response, error: null };

  const [inspectionBody, replayBody] = response.body.tee();
  const reader = inspectionBody.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let lines = 0;
  let error = null;
  let stop = false;

  try {
    while (!stop && lines < INITIAL_INSPECTION_MAX_LINES && bytes < INITIAL_INSPECTION_MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      for (const line of parts) {
        const event = parseEvent(line);
        if (!event?.type) continue;
        lines++;
        if (event.type === "error") {
          error = normalizeError(event);
          stop = true;
          break;
        }
        if (!METADATA_EVENTS.has(event.type)) {
          stop = true;
          break;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const replayResponse = new Response(replayBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  if (error) {
    replayBody.cancel().catch(() => {});
    return { response: replayResponse, error };
  }
  return { response: replayResponse, error: null };
}

function createCommandCodeErrorResponse(error) {
  return new Response(JSON.stringify({
    error: {
      type: error.status >= 500 ? "server_error" : "upstream_error",
      message: error.message,
      code: "commandcode_upstream_error",
      statusCode: error.status,
      isRetryable: error.retryable,
    },
  }), {
    status: error.status,
    headers: { "Content-Type": "application/json" },
  });
}

function wrapNdjsonAsOpenAISse(originalResponse, model) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model };

  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c == null) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Translate AI SDK v5 NDJSON line to one or more OpenAI chunks
        emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller);
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed) {
        emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller);
      }
      controller.enqueue(encoder.encode(SSE_DONE));
    },
  });

  const newBody = originalResponse.body.pipeThrough(transform);
  return new Response(newBody, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}

export default CommandCodeExecutor;
