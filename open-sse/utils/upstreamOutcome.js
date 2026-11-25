// Classifies an upstream reply that arrived with HTTP 2xx but is semantically a
// failure (error envelope, empty output, truncated stream) so the caller can
// route it like any other upstream error instead of recording a success.
import { Buffer } from "node:buffer";
import { FORMATS } from "../translator/formats.js";
import {
  CLAUDE_BLOCK, CLAUDE_DELTA, CLAUDE_EVENT, OPENAI_BLOCK, OPENAI_FINISH,
  RESPONSES_EVENT, RESPONSES_INCOMPLETE_REASON, RESPONSES_ITEM, RESPONSES_STATUS, STREAM_ERROR_EVENT,
} from "../translator/schema/index.js";
import { NO_RETRY_EMPTY_FINISH } from "../translator/schema/finishReasons.js";
import { toOpenAIFinish } from "../translator/concerns/finishReason.js";
import { createErrorResult } from "./error.js";

export const OUTCOME_STATE = Object.freeze({
  PENDING: "pending",
  OK: "ok",
  PRECOMMIT_FAILURE: "retryable_precommit_failure",
  COMMITTED_FAILURE: "committed_failure",
  CLIENT_ABORTED: "client_aborted",
});

// Machine-readable reason carried as `errorKind` on failed results.
export const OUTCOME_ERROR = Object.freeze({
  PAYLOAD_ERROR: "upstream_payload_error",
  EMPTY: "empty_upstream_response",
  INCOMPLETE: "upstream_incomplete",
  INVALID: "invalid_upstream_json",
  INVALID_CONTENT_TYPE: "invalid_upstream_content_type",
  UNSUPPORTED: "unsupported_upstream_payload",
  RESET: "upstream_reset",
  STALL: "upstream_stall",
  ABORTED: "aborted",
});

const GEMINI_FAMILY = new Set([FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX, FORMATS.ANTIGRAVITY]);

// Wire dialects whose success/terminal shapes are understood here. Other formats
// (executor-specific streams such as Kiro, Cursor or CommandCode NDJSON) are never
// failed for an unrecognized shape and keep the pass-through lifecycle.
const OUTCOME_FORMATS = new Set([FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE, FORMATS.OLLAMA, ...GEMINI_FAMILY]);

export function supportsOutcome(format) {
  return OUTCOME_FORMATS.has(format);
}

const RESPONSES_FAILURE_EVENTS = new Set([RESPONSES_EVENT.FAILED, STREAM_ERROR_EVENT]);
// response.incomplete (max_output_tokens, content filter) is a terminal like a chat
// finish_reason "length": valid when it carried output, empty otherwise.
const RESPONSES_TERMINAL_EVENTS = new Set([RESPONSES_EVENT.COMPLETED, RESPONSES_EVENT.DONE, RESPONSES_EVENT.INCOMPLETE]);
const RESPONSES_TERMINAL_STATUSES = new Set([RESPONSES_STATUS.COMPLETED, RESPONSES_STATUS.INCOMPLETE]);
const RESPONSES_TEXT_EVENTS = new Set([RESPONSES_EVENT.OUTPUT_TEXT_DELTA, RESPONSES_EVENT.REASONING_TEXT_DELTA, RESPONSES_EVENT.REASONING_SUMMARY_TEXT_DELTA]);
const RESPONSES_TOOL_ITEMS = new Set([RESPONSES_ITEM.FUNCTION_CALL, RESPONSES_ITEM.CUSTOM_TOOL_CALL, RESPONSES_ITEM.COMPUTER_CALL]);
const RESPONSES_OUTPUT_ITEMS = new Set([...RESPONSES_TOOL_ITEMS, RESPONSES_ITEM.IMAGE_GENERATION_CALL]);
const CONTENT_PART_OUTPUT_TYPES = new Set([CLAUDE_BLOCK.TOOL_USE, RESPONSES_ITEM.FUNCTION_CALL, RESPONSES_ITEM.CUSTOM_TOOL_CALL, OPENAI_BLOCK.IMAGE, OPENAI_BLOCK.IMAGE_URL]);
const VIDEO_FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

const nonEmptyString = (value) => typeof value === "string" && value.length > 0;

/** createErrorResult plus a machine-readable `errorKind` (see OUTCOME_ERROR). */
export function outcomeErrorResult(statusCode, message, errorKind) {
  return { ...createErrorResult(statusCode, message), errorKind };
}

function asMessage(value, fallback = "Upstream returned an error payload") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return fallback;
  const nested = value.message || value.detail;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (nested && typeof nested === "object") return asMessage(nested, fallback);
  return value.code || value.type || fallback;
}

/** `{ message, errorKind }` for an error envelope (`error`, `errors[]`, `response.error`), else null. */
export function extractPayloadError(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.error) {
    return { message: asMessage(payload.error), errorKind: payload.errorKind || payload.error?.errorKind || OUTCOME_ERROR.PAYLOAD_ERROR };
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return { message: asMessage(payload.errors[0]), errorKind: OUTCOME_ERROR.PAYLOAD_ERROR };
  }
  if (payload.response && typeof payload.response === "object" && payload.response.error) {
    return { message: asMessage(payload.response.error), errorKind: OUTCOME_ERROR.PAYLOAD_ERROR };
  }
  return null;
}

function hasOpenAIChatEvidence(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message || choice?.delta;
  if (!message) return false;
  if ([message.content, message.reasoning_content, message.reasoning].some(nonEmptyString)) return true;
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function hasClaudeEvidence(payload) {
  if (!Array.isArray(payload?.content)) return false;
  return payload.content.some((block) =>
    (block?.type === CLAUDE_BLOCK.TEXT && nonEmptyString(block.text))
    || (block?.type === CLAUDE_BLOCK.THINKING && nonEmptyString(block.thinking))
    || block?.type === CLAUDE_BLOCK.TOOL_USE
  );
}

function hasResponsesEvidence(payload) {
  const items = payload?.output || payload?.response?.output;
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    if (!item || typeof item !== "object") return false;
    if (RESPONSES_OUTPUT_ITEMS.has(item.type)) return true;
    if (item.type === RESPONSES_ITEM.REASONING) {
      return (item.summary || item.content || []).some((part) => nonEmptyString(part?.text));
    }
    return (item.content || []).some((part) => nonEmptyString(part?.text) || nonEmptyString(part?.image_url));
  });
}

function geminiCandidates(payload) {
  return payload?.response?.candidates || payload?.candidates || [];
}

function hasGeminiEvidence(payload) {
  return geminiCandidates(payload).some((candidate) =>
    (candidate?.content?.parts || []).some((part) =>
      nonEmptyString(part?.text)
      || !!part?.functionCall
      || !!part?.function_call
      || !!part?.inlineData?.data
      || !!part?.inline_data?.data
    )
  );
}

function hasGenericCompatibleEvidence(payload) {
  if (!payload || typeof payload !== "object") return false;

  const strings = [
    payload.content, payload.text, payload.output_text,
    payload.reasoning, payload.reasoning_content, payload.thinking,
    payload.response, payload.message?.content, payload.message?.reasoning,
    payload.message?.reasoning_content, payload.message?.thinking,
    payload.delta?.content, payload.delta?.text, payload.delta?.reasoning,
    payload.delta?.reasoning_content, payload.delta?.thinking,
  ];
  if (strings.some(nonEmptyString)) return true;

  const toolCalls = [payload.tool_calls, payload.message?.tool_calls, payload.delta?.tool_calls];
  if (toolCalls.some((calls) => Array.isArray(calls) && calls.length > 0)) return true;
  if (payload.function_call || payload.functionCall || payload.message?.function_call || payload.delta?.function_call) return true;

  const content = payload.content || payload.message?.content;
  return Array.isArray(content) && content.some((part) =>
    nonEmptyString(part) || nonEmptyString(part?.text) || nonEmptyString(part?.thinking) || CONTENT_PART_OUTPUT_TYPES.has(part?.type)
  );
}

// Tool-call output is useful but not yet safe to stream: a call can still be cut
// off, so a stream showing only tool calls is held until its terminal.
function hasStreamToolCallShape(payload) {
  const choice = payload?.choices?.[0];
  if (Array.isArray(choice?.delta?.tool_calls) && choice.delta.tool_calls.length > 0) return true;
  if (choice?.delta?.function_call || choice?.message?.function_call) return true;
  if (Array.isArray(payload?.tool_calls) && payload.tool_calls.length > 0) return true;
  if (Array.isArray(payload?.message?.tool_calls) && payload.message.tool_calls.length > 0) return true;
  if (payload?.function_call || payload?.functionCall) return true;
  if (RESPONSES_TOOL_ITEMS.has(payload?.item?.type)) return true;
  if (payload?.type === CLAUDE_EVENT.CONTENT_BLOCK_START && payload?.content_block?.type === CLAUDE_BLOCK.TOOL_USE) return true;
  if (payload?.type === CLAUDE_EVENT.CONTENT_BLOCK_DELTA && payload?.delta?.type === CLAUDE_DELTA.INPUT_JSON) return true;
  return geminiCandidates(payload).some((candidate) =>
    (candidate?.content?.parts || []).some((part) => part?.functionCall || part?.function_call)
  );
}

// Finish/stop reason of a terminal payload in the hub (OpenAI) vocabulary, or null.
function hubFinishReason(payload) {
  const choiceFinish = payload?.choices?.[0]?.finish_reason;
  if (choiceFinish) return choiceFinish;
  const claudeStop = payload?.delta?.stop_reason || payload?.stop_reason;
  if (claudeStop) return toOpenAIFinish(claudeStop, FORMATS.CLAUDE);
  const geminiFinish = geminiCandidates(payload)[0]?.finishReason;
  if (geminiFinish) return toOpenAIFinish(geminiFinish, FORMATS.GEMINI);
  const incomplete = payload?.response?.incomplete_details || payload?.incomplete_details;
  if (incomplete?.reason === RESPONSES_INCOMPLETE_REASON.CONTENT_FILTER) return OPENAI_FINISH.CONTENT_FILTER;
  return null;
}

// A content filter / refusal is a legitimate empty answer that would recur on every
// account or combo member, so it is not an empty-output failure.
function isDeliberateEmpty(finishReason) {
  return NO_RETRY_EMPTY_FINISH.has(finishReason);
}

const empty = (message) => ({ ok: false, errorKind: OUTCOME_ERROR.EMPTY, message });
const incomplete = (message) => ({ ok: false, errorKind: OUTCOME_ERROR.INCOMPLETE, message });

/** Judge a non-streaming chat body in its upstream `format`. */
export function evaluateChatJson(payload, format) {
  const outcome = evaluateChatShape(payload, format);
  if (outcome.errorKind === OUTCOME_ERROR.EMPTY && isDeliberateEmpty(hubFinishReason(payload))) return { ok: true };
  return outcome;
}

function evaluateChatShape(payload, format) {
  const error = extractPayloadError(payload);
  if (error) return { ok: false, ...error };
  if (!payload || typeof payload !== "object") return empty("Upstream returned an empty response");

  // Judge by body shape first: an executor may answer in another dialect than the
  // target format it was asked for (e.g. Chat Completions behind a Claude route).
  if (Array.isArray(payload.choices)) {
    if (hasOpenAIChatEvidence(payload)) return { ok: true };
    if (payload.choices[0]?.finish_reason != null) return empty("Chat response finished without output");
    return incomplete("Chat response ended without output or finish_reason");
  }

  if (format === FORMATS.OPENAI_RESPONSES || payload.object === "response") {
    const status = payload.status || payload.response?.status;
    if (status === RESPONSES_STATUS.FAILED) {
      return { ok: false, errorKind: OUTCOME_ERROR.PAYLOAD_ERROR, message: "Upstream response failed" };
    }
    if (status === RESPONSES_STATUS.IN_PROGRESS) return incomplete("Upstream response ended before a terminal event");
    if (hasResponsesEvidence(payload)) return { ok: true };
    if (RESPONSES_TERMINAL_STATUSES.has(status)) return empty("Upstream completed without output");
    return incomplete("Upstream response ended without a completed response");
  }

  if (format === FORMATS.CLAUDE || payload.type === "message") {
    if (hasClaudeEvidence(payload)) return { ok: true };
    if (payload.stop_reason) return empty("Claude response stopped without output");
    return incomplete("Claude response ended without output or stop_reason");
  }

  if (GEMINI_FAMILY.has(format) || Array.isArray(payload.candidates) || Array.isArray(payload.response?.candidates)) {
    if (hasGeminiEvidence(payload)) return { ok: true };
    if (geminiCandidates(payload).some((candidate) => !!candidate?.finishReason)) return empty("Gemini response finished without output");
    return incomplete("Gemini response ended without output or finishReason");
  }

  if (format === FORMATS.OLLAMA || payload.done !== undefined) {
    if (hasGenericCompatibleEvidence(payload)) return { ok: true };
    if (payload.done === true) return empty("Ollama response finished without output");
    return incomplete("Ollama response ended before done=true");
  }

  // A provider that did not opt into envelope unwrapping still delivers its usable
  // body inside {success:true,data:{...}}; judge that inner object.
  if (payload.success === true && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return evaluateChatShape(payload.data, format);
  }

  return hasGenericCompatibleEvidence(payload) || !OUTCOME_FORMATS.has(format)
    ? { ok: true }
    : { ok: false, errorKind: OUTCOME_ERROR.UNSUPPORTED, message: "Upstream payload contained no recognizable output" };
}

// Lenient on layout (line breaks, concatenated padded chunks, URL-safe alphabet)
// but rejects text that is not base64 at all or decodes to nothing.
export function decodeBase64(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, "");
  if (!compact || /[^A-Za-z0-9+/=_-]/.test(compact)) return null;
  const decoded = Buffer.from(compact, "base64");
  return decoded.length > 0 ? decoded : null;
}

// A vector is a non-empty array of finite numbers, or a base64 string when the
// client asked for encoding_format=base64 (some upstreams ignore that field).
function validEmbedding(value) {
  if (typeof value === "string") return decodeBase64(value) !== null;
  return Array.isArray(value) && value.length > 0 && value.every((item) => Number.isFinite(item));
}

export function evaluateEmbeddingJson(payload, { allowEmpty = false } = {}) {
  const error = extractPayloadError(payload);
  if (error) return { ok: false, ...error };

  const vectors = [];
  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) vectors.push(item?.embedding);
  } else if (Array.isArray(payload?.embeddings)) {
    for (const item of payload.embeddings) vectors.push(Array.isArray(item) ? item : item?.values);
  } else if (payload?.embedding) {
    vectors.push(Array.isArray(payload.embedding) ? payload.embedding : payload.embedding.values);
  }

  if (vectors.length === 0 && allowEmpty) return { ok: true };
  if (vectors.length > 0 && vectors.every(validEmbedding)) return { ok: true };
  return { ok: false, errorKind: OUTCOME_ERROR.INVALID, message: "Upstream returned no valid embedding vectors" };
}

export function evaluateAudioResult(result) {
  if (!nonEmptyString(result?.base64)) return empty("Upstream returned no audio");
  if (!decodeBase64(result.base64)) return { ok: false, errorKind: OUTCOME_ERROR.INVALID, message: "Upstream returned invalid audio data" };
  return { ok: true };
}

export function evaluateImageJson(payload) {
  const error = extractPayloadError(payload);
  if (error) return { ok: false, ...error };
  const items = payload?.data;
  if (!Array.isArray(items) || items.length === 0) return empty("Upstream returned no image");

  if (items.some((item) => decodeBase64(item?.b64_json) !== null || nonEmptyString(item?.url?.trim?.()))) return { ok: true };
  return items.some((item) => typeof item?.b64_json === "string")
    ? { ok: false, errorKind: OUTCOME_ERROR.INVALID, message: "Upstream returned invalid image data" }
    : empty("Upstream returned no image");
}

/**
 * A video creation POST must hand back a job to poll (or the finished video).
 * Poll responses are not judged here: a failed job is a valid poll answer and
 * provider status vocabularies differ, so they keep passing through verbatim.
 */
export function evaluateVideoCreation(payload) {
  const error = extractPayloadError(payload);
  const status = String(payload?.status || "").toLowerCase();
  if (error || VIDEO_FAILED_STATUSES.has(status)) {
    return { ok: false, errorKind: error?.errorKind || OUTCOME_ERROR.PAYLOAD_ERROR, message: error?.message || `Video job ${status}` };
  }
  const hasJobId = [payload?.request_id, payload?.id].some((id) => nonEmptyString(id?.trim?.()));
  const hasVideo = [payload?.url, payload?.video?.url].some((url) => nonEmptyString(url?.trim?.()));
  return hasJobId || hasVideo
    ? { ok: true }
    : { ok: false, errorKind: OUTCOME_ERROR.INVALID, message: "Upstream returned no video job id" };
}

// null, or { committable } — committable output may be streamed to the client
// right away; non-committable output (tool calls) waits for the terminal.
function streamEvidence(payload, eventName) {
  if (RESPONSES_TEXT_EVENTS.has(eventName)) return nonEmptyString(payload?.delta) ? { committable: true } : null;
  if (payload?.item?.type === RESPONSES_ITEM.IMAGE_GENERATION_CALL) return { committable: true };
  if (payload?.type === CLAUDE_EVENT.CONTENT_BLOCK_DELTA && nonEmptyString(payload?.delta?.partial_json)) return { committable: false };
  if ([payload?.delta?.text, payload?.delta?.thinking, payload?.delta?.reasoning_content].some(nonEmptyString)) return { committable: true };
  if (hasStreamToolCallShape(payload)) return { committable: false };
  if (hasResponsesEvidence(payload) || hasGeminiEvidence(payload) || hasOpenAIChatEvidence(payload) || hasGenericCompatibleEvidence(payload)) {
    return { committable: true };
  }
  return null;
}

/**
 * Track one streamed upstream response from first byte to its end.
 *
 * A failure before anything was sent downstream (`retryable_precommit_failure`)
 * can still be routed to another account or combo member; after `commit()` it is
 * a `committed_failure` that can only be reported. `ok` requires a valid terminal
 * plus useful output (or a deliberate content-filter/refusal terminal).
 */
export function createStreamingOutcomeTracker({ format, committed = false } = {}) {
  let state = OUTCOME_STATE.PENDING;
  let error = null;
  let errorKind = null;
  let terminalClass = null;
  let finishReason = null;
  let usefulOutputSeen = false;
  let committableOutputSeen = false;
  let downstreamCommitted = committed;
  let clientDisconnected = false;

  const settled = () => state === OUTCOME_STATE.OK || state === OUTCOME_STATE.CLIENT_ABORTED || terminalClass === "failure";

  const fail = (kind, message) => {
    if (settled()) return snapshot();
    errorKind = kind || OUTCOME_ERROR.PAYLOAD_ERROR;
    error = message || "Upstream stream failed";
    terminalClass = "failure";
    state = downstreamCommitted ? OUTCOME_STATE.COMMITTED_FAILURE : OUTCOME_STATE.PRECOMMIT_FAILURE;
    return snapshot();
  };

  const observe = ({ event = null, data, doneSentinel = false, malformed = false } = {}) => {
    if (settled()) return snapshot();
    if (malformed) return fail(OUTCOME_ERROR.INVALID, "Upstream SSE contained malformed JSON");

    const payloadError = extractPayloadError(data);
    if (payloadError) return fail(payloadError.errorKind, payloadError.message);

    const eventType = event || data?.type || null;
    const responsesStatus = data?.response?.status || data?.status;
    finishReason = hubFinishReason(data) || finishReason;
    if (geminiCandidates(data)[0]?.finishReason || eventType === CLAUDE_EVENT.MESSAGE_STOP) {
      terminalClass = "success";
    } else if (RESPONSES_FAILURE_EVENTS.has(eventType) || responsesStatus === RESPONSES_STATUS.FAILED) {
      return fail(OUTCOME_ERROR.PAYLOAD_ERROR, asMessage(data?.response?.error || data?.error || data, `Upstream emitted ${eventType || responsesStatus}`));
    } else if (RESPONSES_TERMINAL_EVENTS.has(eventType) || RESPONSES_TERMINAL_STATUSES.has(responsesStatus)) {
      terminalClass = "success";
    } else if (format === FORMATS.OLLAMA) {
      if (data?.done === true) terminalClass = "success";
    } else if (format !== FORMATS.OPENAI_RESPONSES && format !== FORMATS.CLAUDE && !GEMINI_FAMILY.has(format)) {
      if (data?.choices?.[0]?.finish_reason != null || doneSentinel) terminalClass = "success";
    }

    const evidence = streamEvidence(data, eventType);
    if (evidence) {
      usefulOutputSeen = true;
      if (evidence.committable) committableOutputSeen = true;
    }
    return snapshot();
  };

  const commit = () => {
    downstreamCommitted = true;
    return snapshot();
  };

  const finish = () => {
    if (settled()) return snapshot();
    if (terminalClass === "success" && (usefulOutputSeen || isDeliberateEmpty(finishReason))) state = OUTCOME_STATE.OK;
    else if (terminalClass === "success") fail(OUTCOME_ERROR.EMPTY, "Upstream stream reached a terminal event without recognizable output");
    else fail(OUTCOME_ERROR.INCOMPLETE, "Upstream stream ended without a valid terminal event");
    return snapshot();
  };

  const abortClient = (message = "Client disconnected") => {
    clientDisconnected = true;
    if (settled()) return snapshot();
    // Responses clients (codex) close the socket right after response.completed:
    // a cancel that follows a valid terminal with output is a finished request.
    if (terminalClass === "success" && usefulOutputSeen) {
      state = OUTCOME_STATE.OK;
      return snapshot();
    }
    errorKind = OUTCOME_ERROR.ABORTED;
    error = message;
    state = OUTCOME_STATE.CLIENT_ABORTED;
    return snapshot();
  };

  function snapshot() {
    return {
      state,
      ok: state === OUTCOME_STATE.OK,
      error,
      errorKind,
      terminalClass,
      usefulOutputSeen,
      committableOutputSeen,
      downstreamCommitted,
      clientDisconnected,
      fallbackAllowed: state === OUTCOME_STATE.PRECOMMIT_FAILURE,
    };
  }

  return { observe, fail, commit, finish, abortClient, snapshot };
}

/**
 * Incremental SSE parser. Emits one event per terminated SSE block and one per
 * bare JSON line (NDJSON streams such as Ollama have no blank-line separators).
 * Returns the unconsumed tail to prepend to the next chunk.
 */
export function parseSSEBlocks(text, onEvent) {
  const normalized = text.replace(/\r\n/g, "\n");
  let event = null;
  let dataLines = [];
  let blockStart = 0;
  let pos = 0;

  const emit = (raw, eventName) => {
    if (raw === "[DONE]") {
      onEvent({ event: eventName, data: null, doneSentinel: true });
      return;
    }
    try {
      onEvent({ event: eventName, data: JSON.parse(raw), doneSentinel: false });
    } catch {
      onEvent({ event: eventName, data: null, malformed: true });
    }
  };

  let newline;
  while ((newline = normalized.indexOf("\n", pos)) !== -1) {
    const line = normalized.slice(pos, newline);
    pos = newline + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      const raw = dataLines.join("\n").trim();
      if (raw) emit(raw, event);
      event = null;
      dataLines = [];
      blockStart = pos;
    } else if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    } else if (trimmed.startsWith("{")) {
      if (event === null && dataLines.length === 0) {
        emit(trimmed, null);
        blockStart = pos;
      } else {
        dataLines.push(trimmed);
      }
    }
  }
  return normalized.slice(blockStart);
}
