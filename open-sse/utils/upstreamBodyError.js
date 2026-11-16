/**
 * Upstream failures that arrive inside an HTTP 200.
 *
 * Some gateways answer 200 and put the failure in the body: `{"error": "..."}` as
 * the whole JSON, as the first SSE frame, or as a bare JSON object behind an SSE
 * content-type. Everything downstream keys off the HTTP status, so such an answer
 * counted as a success: the error text reached the client as if it were the reply,
 * and neither account fallback nor the combo moved on. A client that gets that as
 * its answer just stops.
 *
 * This reads a failure out of the body and gives it the status it would have had
 * had the upstream been honest, so the ordinary error path (cooldown, next
 * account, next combo model) takes over. Everything here is fail-open: anything
 * that is not clearly an error is handed back untouched.
 *
 * Limit: failover is only possible before the first byte reaches the client. A
 * stream is therefore held back for a short window after its first frame
 * (BODY_ERROR_HOLD_MS / BODY_ERROR_HOLD_BYTES) so that an error arriving right
 * behind the first content can still fail over; an error after the window cannot
 * be taken back, and is passed on as a standard error frame.
 */

export const BODY_ERROR_PEEK_BYTES = 8 * 1024;
export const BODY_ERROR_PEEK_TIMEOUT_MS = 15 * 1000;
export const BODY_ERROR_HOLD_BYTES = 4 * 1024;

/**
 * How long a stream is held after its first frame, waiting to see whether an
 * error follows. Costs that much first-token latency on every stream, so it is
 * short; `STREAM_ERROR_HOLD_MS=0` decides on the first frame alone.
 */
export function resolveHoldMs(env = process.env) {
  const raw = Number(env?.STREAM_ERROR_HOLD_MS);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 10_000) : 500;
}

const CREDIT_HINTS = [
  "exhausted its credit",
  "out of credit",
  "no credits",
  "insufficient credit",
  "insufficient balance",
  "insufficient funds",
  "insufficient_quota",
  "credit balance",
  "payment required",
];
const RATE_HINTS = ["rate limit", "too many requests", "overloaded", "capacity", "quota exceeded"];
const AUTH_HINTS = ["invalid api key", "invalid_api_key", "unauthorized", "authentication"];

// Keys that mark a body as a real completion: an `error` field next to any of
// them is not the whole story (and the Responses API's `error: null` is no error).
const COMPLETION_KEYS = ["choices", "output", "content", "candidates"];

const asStatus = (value) => {
  const n = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : null;
};

/** The failure a parsed JSON body carries, or null if it is not one. */
export function extractBodyError(json) {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const err = json.error;
  if (!err) return null;
  if (typeof err !== "string" && (typeof err !== "object" || Array.isArray(err))) return null;
  if (json.type !== "error" && COMPLETION_KEYS.some((key) => json[key] != null)) return null;
  const message = typeof err === "string"
    ? err
    : (typeof err.message === "string" && err.message) || (typeof err.error === "string" && err.error) || JSON.stringify(err);
  const object = typeof err === "object" ? err : {};
  const status = asStatus(object.status) || asStatus(object.code) || asStatus(object.http_status) || asStatus(json.status) || asStatus(json.code);
  return { message: String(message).slice(0, 2000), status };
}

/**
 * The status a body-borne failure is treated as. A numeric status in the body
 * wins; otherwise the wording decides: credits gone → 402 (the account/model is
 * locked for a while), rate/capacity → 429, bad key → 401, anything else → 502
 * (transient: try the next account/model).
 */
export function classifyBodyErrorStatus({ message, status }) {
  if (status) return status;
  const text = String(message || "").toLowerCase();
  if (CREDIT_HINTS.some((hint) => text.includes(hint))) return 402;
  if (RATE_HINTS.some((hint) => text.includes(hint))) return 429;
  if (AUTH_HINTS.some((hint) => text.includes(hint))) return 401;
  return 502;
}

/** `{status, message}` for a failure in a parsed JSON body, or null. */
export function bodyErrorFromJson(json) {
  const found = extractBodyError(json);
  return found ? { status: classifyBodyErrorStatus(found), message: found.message } : null;
}

/**
 * Scan the SSE text read so far.
 * @param {string} text
 * @param {boolean} ended the upstream body is complete (a cut-off last block counts)
 * @param {{firstOnly?: boolean}} [opts] stop at the first real frame
 * @returns {{error: object|null, frames: number, done: boolean, bare: boolean}}
 *   `bare`: the body is one JSON object with no SSE framing, so it is decided.
 */
export function scanSse(text, ended = false, { firstOnly = false } = {}) {
  const result = { error: null, frames: 0, done: false, bare: false };
  const head = text.replace(/^﻿/, "").trimStart();
  if (!head) return result;

  // A bare JSON body behind an SSE content-type: no `data:` framing at all.
  if (head[0] === "{") {
    try {
      result.error = bodyErrorFromJson(JSON.parse(head));
      result.bare = true;
    } catch { /* cut off: read more */ }
    return result;
  }

  const blocks = head.split(/\r?\n\r?\n/);
  // The last block may be cut off; it only counts once the stream has ended.
  const complete = ended ? blocks : blocks.slice(0, -1);
  for (const block of complete) {
    let event = "";
    const data = [];
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line || line.startsWith(":")) continue; // keep-alive comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (!event && data.length === 0) continue;
    const payload = data.join("\n");
    if (payload === "[DONE]") { result.done = true; break; }
    let json = null;
    try { json = JSON.parse(payload); } catch { /* not JSON: ordinary text frame */ }
    let found = json ? bodyErrorFromJson(json) : null;
    if (!found && event === "error") {
      const message = String((json && (json.message || json.error?.message)) || payload || "Upstream error").slice(0, 2000);
      found = { status: classifyBodyErrorStatus({ message }), message };
    }
    if (found) { result.error = found; break; }
    result.frames += 1;
    if (firstOnly) break;
  }
  return result;
}

/**
 * Judge the head of an SSE body by its first real frame.
 * @returns {{error: object|null}|null} null while still undecided (read more);
 *   `{error: null}` once the first real frame is known not to be a failure.
 */
export function inspectSseHead(text, ended = false) {
  const scan = scanSse(text, ended, { firstOnly: true });
  if (scan.error) return { error: scan.error };
  if (scan.frames > 0 || scan.done || scan.bare || ended) return { error: null };
  return null;
}

const TIMED_OUT = Symbol("timed-out");

/**
 * Look at the head of a streaming 200 before committing it to the client.
 *
 * Resolves to `{ error }` when the stream opens with a failure — or one follows
 * within `holdMs` of the first frame (the upstream body is cancelled) — else
 * `{ response }`, an equivalent Response whose body replays what was read and then
 * carries on with the rest, so the caller streams it as if nothing had happened.
 * If no frame arrives within `timeoutMs` (a slow first token), the stream is
 * committed as it is: waiting longer would delay the headers more than the check
 * is worth.
 */
export async function guardStreamHead(response, {
  maxBytes = BODY_ERROR_PEEK_BYTES,
  timeoutMs = BODY_ERROR_PEEK_TIMEOUT_MS,
  holdMs = resolveHoldMs(),
  holdBytes = BODY_ERROR_HOLD_BYTES,
} = {}) {
  if (!response?.ok || !response.body || typeof response.body.getReader !== "function") return { response };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let text = "";
  let ended = false;
  let pending = null;
  let failure = null;
  let firstFrameAt = null;
  const deadline = Date.now() + timeoutMs;

  try {
    while (text.length < maxBytes) {
      // Before the first frame: wait up to the overall deadline. After it: only
      // for the hold window.
      const limit = firstFrameAt === null ? deadline : Math.min(deadline, firstFrameAt + holdMs);
      pending = reader.read();
      let timer;
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), Math.max(limit - Date.now(), 0)); });
      const step = await Promise.race([pending, timeout]);
      clearTimeout(timer);
      if (step === TIMED_OUT) break; // `pending` stays outstanding; the replay picks it up
      pending = null;
      if (step.done) { ended = true; break; }
      chunks.push(step.value);
      text += decoder.decode(step.value, { stream: true });

      const scan = scanSse(text, false);
      if (scan.error) { failure = scan.error; break; }
      if (scan.done || scan.bare) break; // finished, or a complete body that is no error
      if (scan.frames > 0) {
        if (firstFrameAt === null) firstFrameAt = Date.now();
        if (holdMs <= 0 || text.length >= holdBytes) break;
      }
    }
    if (!failure && ended) failure = scanSse(text, true).error;
  } catch {
    // Reading failed: hand the stream on as it is and let the normal path deal with it.
    failure = null;
  }

  if (failure) {
    try { await reader.cancel(); } catch { /* already closed */ }
    return { error: failure };
  }

  let index = 0;
  const replay = new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) { controller.enqueue(chunks[index++]); return; }
      if (ended) { controller.close(); return; }
      try {
        const step = pending ? await pending : await reader.read();
        pending = null;
        if (step.done) controller.close(); else controller.enqueue(step.value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return {
    response: new Response(replay, { status: response.status, statusText: response.statusText, headers: response.headers }),
  };
}
