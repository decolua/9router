// Response-shape helpers. A gateway is supposed to speak SSE when it is asked to
// stream, but plenty of upstreams answer with a finished JSON document anyway (or
// the other way round). Everything here keys off what actually arrived instead of
// what the request asked for, so a mismatch degrades into working traffic instead
// of an empty stream.
import { SSE_CONTENT_TYPE_EVENT_STREAM, SSE_CONTENT_TYPE_JSON, SSE_DATA_PREFIX, SSE_DONE } from "../utils/sseConstants.js";
import { chatChunkSse, sseChunk } from "../utils/sse.js";
import { MODEL_FALLBACK } from "../translator/schema/defaults.js";
import { OPENAI_FINISH } from "../translator/schema/finishReasons.js";

/** Content type the upstream actually sent, lowercased ("" when absent). */
export function contentTypeOf(response) {
  return String(response?.headers?.get("content-type") || "").toLowerCase();
}

export function isEventStreamResponse(response) {
  return contentTypeOf(response).includes(SSE_CONTENT_TYPE_EVENT_STREAM);
}

export function isJsonResponse(response) {
  const ct = contentTypeOf(response);
  return ct.includes(SSE_CONTENT_TYPE_JSON) || ct.includes("application/llm");
}

/**
 * A body is only replayable as chunks when it is an OpenAI chat.completion; any
 * other document (Claude message, Responses object, Gemini candidate) has to go
 * through the JSON path so the normal translators can reshape it.
 */
export function isChatCompletionBody(body) {
  return !!body && typeof body === "object" && Array.isArray(body.choices) && body.choices.length > 0;
}

/**
 * Drain a provider response into a parsed JSON document, or null when the body is
 * empty / not JSON. The caller keeps the parsed value because reading a body
 * consumes it — a second `.json()` on the same Response always throws.
 */
export async function readJsonBody(response) {
  let text = "";
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Re-wrap an already-read JSON document as the Response the JSON path expects. */
export function jsonResponseFromBody(body, sourceResponse) {
  return new Response(JSON.stringify(body), {
    status: sourceResponse?.status || 200,
    headers: { "content-type": SSE_CONTENT_TYPE_JSON },
  });
}

/**
 * Replay a finished chat.completion as OpenAI SSE frames: one content frame (plus
 * reasoning / tool-call frames), a finish frame carrying usage when the upstream
 * reported any, then the `[DONE]` sentinel.
 */
export function completionToSSEText(body) {
  const choice = body.choices?.[0] || {};
  const message = choice.message || choice.delta || {};
  const id = body.id || `chatcmpl-${Date.now()}`;
  const created = body.created || Math.floor(Date.now() / 1000);
  const model = body.model || MODEL_FALLBACK;
  const frames = [];

  if (typeof message.reasoning_content === "string" && message.reasoning_content) {
    frames.push(chatChunkSse({ id, created, model, delta: { reasoning_content: message.reasoning_content } }));
  }
  if (typeof message.content === "string" && message.content) {
    frames.push(chatChunkSse({ id, created, model, delta: { content: message.content } }));
  }
  (message.tool_calls || []).forEach((call, index) => {
    frames.push(chatChunkSse({
      id,
      created,
      model,
      delta: {
        role: "assistant",
        tool_calls: [{
          index: typeof call.index === "number" ? call.index : index,
          id: call.id || `call_${index}`,
          type: call.type || "function",
          function: { name: call.function?.name || "", arguments: call.function?.arguments || "" },
        }],
      },
    }));
  });

  const finishFrame = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || OPENAI_FINISH.STOP }],
  };
  if (body.usage) finishFrame.usage = body.usage;
  frames.push(sseChunk(finishFrame));
  frames.push(SSE_DONE);
  return frames.join("");
}

/** The replayed frames as a Response the streaming pipeline can pipe onward. */
export function sseResponseFromCompletion(body, sourceResponse) {
  return new Response(completionToSSEText(body), {
    status: sourceResponse?.status || 200,
    headers: {
      "content-type": SSE_CONTENT_TYPE_EVENT_STREAM,
      "cache-control": "no-cache",
    },
  });
}

/**
 * Extract the JSON documents out of a streamed body text. Real upstreams deviate
 * from the spec constantly: no space after `data:`, `event:` field lines, NDJSON
 * rows with an SSE content-type, or a whole JSON document wearing an SSE label.
 * Anything unparseable is skipped so keep-alives and truncated tails are ignored.
 */
export function collectJsonFrames(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const whole = JSON.parse(text);
      return Array.isArray(whole) ? whole.filter((item) => item && typeof item === "object") : [whole];
    } catch {
      /* not one document — fall through to the line scan */
    }
  }

  const frames = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const payload = trimmed.startsWith(SSE_DATA_PREFIX)
      ? trimmed.slice(SSE_DATA_PREFIX.length).trim()
      : trimmed;
    if (!payload || payload.startsWith(":")) continue;
    if (!payload.startsWith("{")) continue;
    try {
      frames.push(JSON.parse(payload));
    } catch {
      /* keep-alive comment or partial frame */
    }
  }
  return frames;
}
