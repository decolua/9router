/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Prefixes used when flattening tool turns into plain prose for panel models.
const TOOL_CALL_PREFIX = "[Called tools: ";
const TOOL_RESULT_PREFIX = "[Tool result: ";

// Flatten tool turns into prose so panel models keep the context but can't loop
// on tools: drop the request's tools, turn tool/function results into assistant
// text, and inline assistant tool_calls names instead of the structured field.
function flattenToolHistory(messages) {
  return messages
    .filter((msg) => msg)
    .map((msg) => {
      if (msg.role === "tool" || msg.role === "function") {
        return { role: "assistant", content: `${TOOL_RESULT_PREFIX}${extractTextContent(msg.content) || String(msg.content ?? "")}]` };
      }
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const { tool_calls, ...rest } = msg;
        const names = tool_calls.map((c) => c?.function?.name || c?.name || "tool").join(", ");
        const base = extractTextContent(rest.content) || (typeof rest.content === "string" ? rest.content : "");
        return { ...rest, content: `${base}${base ? "\n" : ""}${TOOL_CALL_PREFIX}${names}]` };
      }
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some((c) => c.type === "tool_use");
        const hasToolResult = msg.content.some((c) => c.type === "tool_result");
        if (hasToolUse || hasToolResult) {
          const textParts = [];
          const toolNames = [];
          const toolResults = [];
          for (const block of msg.content) {
            if (block.type === "text" && block.text) textParts.push(block.text);
            if (block.type === "tool_use") toolNames.push(block.name || "tool");
            if (block.type === "tool_result") toolResults.push(extractTextContent(block.content) || String(block.content ?? ""));
          }
          const { ...rest } = msg;
          let newContent = textParts.join("\n");
          if (toolNames.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_CALL_PREFIX}${toolNames.join(", ")}]`;
          }
          if (toolResults.length > 0) {
            newContent = `${newContent}${newContent ? "\n" : ""}${TOOL_RESULT_PREFIX}${toolResults.join("\n")}]`;
          }
          return { ...rest, content: newContent };
        }
      }
      return msg;
    });
}

// Reorder combo models by capability fit. Stable; never drops a model (fallback intact).
// Tier 0: satisfies all hard + all soft. Tier 1: all hard only. Tier 2: rest.
export function reorderByCapabilities(models, required) {
  if (!required || required.size === 0 || !Array.isArray(models) || models.length <= 1) return models;
  const hard = [...required].filter((c) => HARD_CAPS.has(c));
  const soft = [...required].filter((c) => !HARD_CAPS.has(c));

  const tierOf = (m) => {
    const slash = typeof m === "string" ? m.indexOf("/") : -1;
    const provider = slash > 0 ? m.slice(0, slash) : "";
    const model = slash > 0 ? m.slice(slash + 1) : m;
    const caps = getCapabilitiesForModel(provider, model);
    if (!hard.every((c) => caps[c] === true)) return 2;
    return soft.every((c) => caps[c] === true) ? 0 : 1;
  };

  // Stable sort by tier (Array.prototype.sort is stable in modern engines).
  return models
    .map((m, i) => ({ m, i, t: tierOf(m) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

// Trailing run of items after the last assistant/model turn = the current user
// turn. It may span several messages (e.g. text + image split across blocks),
// so we return all of them. History media (older turns) must not pin the combo
// to a vision model — those get stripped + placeholdered downstream instead.
function trailingUserItems(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const isAssistant = (r) => r === "assistant" || r === "model";
  let i = arr.length - 1;
  while (i >= 0 && !isAssistant(arr[i]?.role)) i--;
  return arr.slice(i + 1);
}

// Detect which capabilities a request needs. Modalities (vision/pdf) are scanned
// only on the current user turn; "search" is request-wide (lives in tools).
// Returns a Set of: "vision" | "pdf" | "search".
export function detectRequiredCapabilities(body) {
  const required = new Set();
  if (!body || typeof body !== "object") return required;

  const addByMime = (mime) => {
    if (typeof mime !== "string") return;
    if (mime.startsWith("image/")) required.add("vision");
    else if (mime === "application/pdf") required.add("pdf");
    else if (mime.startsWith("audio/")) required.add("audioInput");
    else if (mime.startsWith("video/")) required.add("videoInput");
  };

  const scanBlock = (b) => {
    if (!b || typeof b !== "object") return;
    const t = b.type;
    if (t === "image_url" || t === "image" || t === "input_image") required.add("vision");
    if (t === "input_audio" || t === "audio_url" || t === "audio") required.add("audioInput");
    if (t === "input_video" || t === "video_url" || t === "video") required.add("videoInput");
    if (t === "file" || t === "document" || t === "input_file") {
      // Infer modality from embedded mime when available; fall back to pdf for generic files.
      let fmime = null;
      if (b.input_audio?.format) fmime = `audio/${b.input_audio.format}`;
      else if (b.file?.file_data) fmime = String(b.file.file_data).match(/^data:([^;,]+)/)?.[1];
      else if (b.source?.media_type) fmime = b.source.media_type;
      else if (b.source?.data) fmime = String(b.source.data).match(/^data:([^;,]+)/)?.[1];
      if (fmime) addByMime(fmime);
      else required.add("pdf");
    }
    // gemini parts: inlineData/fileData carry a mime
    addByMime(b.inlineData?.mimeType || b.fileData?.mimeType);
  };

  const scanContent = (content) => {
    if (Array.isArray(content)) for (const b of content) scanBlock(b);
  };

  const scanMessage = (m) => {
    if (!m || typeof m !== "object") return;

    // Ollama / Hermes images array (strings or objects)
    if (Array.isArray(m.images) && m.images.length > 0) {
      required.add("vision");
    }

    // Vercel AI SDK / Hermes attachments / experimental_attachments
    const attachments = m.experimental_attachments || m.attachments;
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        if (!att) continue;
        const mime = att.contentType || att.mediaType || (typeof att.url === "string" && att.url.match(/^data:([^;,]+)/)?.[1]);
        if (mime) addByMime(mime);
        else if (att.url || att.data) required.add("vision");
      }
    }

    // Direct message-level modality properties
    if (m.image_url || m.image) required.add("vision");
    if (m.audio_url || m.audio) required.add("audioInput");

    // Scan array content blocks
    scanContent(m.content);

    // Scan string content for embedded data URIs
    if (typeof m.content === "string") {
      if (m.content.includes("data:image/")) required.add("vision");
      else if (m.content.includes("data:audio/")) required.add("audioInput");
      else if (m.content.includes("data:application/pdf")) required.add("pdf");
    }
  };

  // Modalities: current user turn only (trailing user run across each known shape).
  for (const m of trailingUserItems(body.messages)) scanMessage(m);              // openai / claude / hermes / ollama
  for (const it of trailingUserItems(body.input)) scanContent(it.content);       // responses
  const contents = body.contents || body.request?.contents;                      // gemini / antigravity
  for (const c of trailingUserItems(contents)) scanContent(c.parts);

  // search: temporarily disabled in auto-switch (feature not wired yet).

  return required;
}

function normalizeStickyLimit(stickyLimit) {
  const parsed = Number.parseInt(stickyLimit, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function rotateModelsFromIndex(models, currentIndex) {
  const rotatedModels = [...models];
  for (let i = 0; i < currentIndex; i++) {
    const moved = rotatedModels.shift();
    rotatedModels.push(moved);
  }
  return rotatedModels;
}

/**
 * Get rotated model list based on strategy
 * @param {string[]} models - Array of model strings
 * @param {string} comboName - Name of the combo
 * @param {string} strategy - "fallback" or "round-robin"
 * @param {number|string} [stickyLimit=1] - Requests per combo model before switching
 * @returns {string[]} Rotated models array
 */
export function getRotatedModels(models, comboName, strategy, stickyLimit = 1) {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return models;
  }

  const rotationKey = comboName || "__default__";
  const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
  const existingState = comboRotationState.get(rotationKey);
  const state = typeof existingState === "number"
    ? { index: existingState, consecutiveUseCount: 0 }
    : (existingState || { index: 0, consecutiveUseCount: 0 });

  const currentIndex = state.index % models.length;
  const rotatedModels = rotateModelsFromIndex(models, currentIndex);
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= normalizedStickyLimit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotatedModels;
}

/**
 * Reset in-memory rotation state when combo/settings change
 * @param {string} [comboName] - Combo name to reset; omit to clear all
 */
export function resetComboRotation(comboName) {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

/**
 * Get combo models from combos data
 * @param {string} modelStr - Model string to check
 * @param {Array|Object} combosData - Array of combos or object with combos
 * @returns {string[]|null} Array of models or null if not a combo
 */
export function getComboModelsFromData(modelStr, combosData) {
  // Don't check if it's in provider/model format
  if (modelStr.includes("/")) return null;
  
  // Handle both array and object formats
  const combos = Array.isArray(combosData) ? combosData : (combosData?.combos || []);
  
  const combo = combos.find(c => c.name === modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Attempt a single combo model and normalize the outcome for both the sequential
 * and hybrid paths. Never throws — a thrown error becomes { ok:false, error }.
 * @returns {Promise<Object>} outcome:
 *   { ok:true, result, modelStr }
 *   { ok:false, result, modelStr, errorText, retryAfter, status, shouldFallback, cooldownMs }
 *   { ok:false, error, modelStr, errorText, status:500, shouldFallback:true }
 */
async function attemptComboModel(body, modelStr, handleSingleModel) {
  try {
    const result = await handleSingleModel(body, modelStr);

    if (result.ok) return { ok: true, result, modelStr };

    // Extract error info from response
    let errorText = result.statusText || "";
    let retryAfter = null;
    try {
      const errorBody = await result.clone().json();
      errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
      retryAfter = errorBody?.retryAfter || null;
    } catch {
      // Ignore JSON parse errors
    }

    // Normalize error text to string (Worker-safe)
    if (typeof errorText !== "string") {
      try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
    }

    const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);
    return { ok: false, result, modelStr, errorText, retryAfter, status: result.status, shouldFallback, cooldownMs };
  } catch (error) {
    return { ok: false, error, modelStr, errorText: error.message || String(error), status: 500, shouldFallback: true };
  }
}

// Best-effort cancel of a losing raced response so its (possibly streaming) body
// doesn't leak once a sibling has already won the race.
function cancelOutcome(outcome) {
  const res = outcome && outcome.result;
  if (res && res.body && !res.bodyUsed) {
    try { res.body.cancel(); } catch { /* ignore */ }
  }
}

// Race a set of already-started attempts, resolving with the first successful
// outcome (returning that response, canceling the losers). If none succeed,
// returns { failures: [...] } preserving input order. This is the HEADERS race —
// for streaming hybrid requests use raceToFirstToken below.
async function raceComboAttempts(attempts) {
  const pending = new Map(attempts.map((a, i) => [i, a.promise]));
  const failures = new Array(attempts.length);
  while (pending.size > 0) {
    const { i, outcome } = await Promise.race(
      [...pending.entries()].map(async ([idx, p]) => ({ i: idx, outcome: await p }))
    );
    pending.delete(i);
    if (outcome.ok) {
      for (const [, p] of pending) Promise.resolve(p).then(cancelOutcome).catch(() => {});
      return { winner: outcome };
    }
    failures[i] = outcome;
  }
  return { failures: failures.filter(Boolean) };
}

// Hybrid TTFT race tuning: how long the streaming race waits, from the moment
// it starts, for any raced model to produce a first token (bounds both the
// headers wait and the token wait). Overridable via handleComboChat options;
// <= 0 disables the deadline.
const HYBRID_FIRST_TOKEN_TIMEOUT_MS = 20000;

/**
 * Advance one already-started hybrid attempt to its first token.
 *
 * For a streaming response that means actually reading the first chunk of the
 * body: the race must not resolve on HTTP headers alone, because a provider
 * can answer 200 fast and then trickle tokens (the client's perceived latency
 * is TTFT + token rate, and headers say nothing about either). Bodies that
 * can't be peeked (non-readable / already locked) resolve as `readyNoBody` —
 * headers are all there is to wait for.
 *
 * Success shapes (on top of the attemptComboModel outcome):
 *   { ok: true, reader, firstChunk, ttftMs }  — streaming, token available
 *   { ok: true, readyNoBody: true }          — nothing to peek
 * Failure shape mirrors attemptComboModel (ok:false, shouldFallback, ...) with
 * `reader` attached when one was acquired, so the race can release the stream.
 * Never throws; the attempt promise itself never rejects.
 *
 * `onReader` fires the moment the body reader is acquired — BEFORE the first
 * read — so the race can cancel a stalled attempt even while its first read
 * is still pending (cancel makes pending reads resolve {done:true} per the
 * streams spec).
 */
async function attemptToFirstToken(attempt, t0, onReader) {
  const outcome = await attempt.promise; // attemptComboModel never rejects
  if (!outcome.ok) return outcome;

  const res = outcome.result;
  if (!res || !res.body || typeof res.body.getReader !== "function") {
    return { ...outcome, readyNoBody: true };
  }

  let reader;
  try {
    reader = res.body.getReader();
  } catch {
    // Body locked or otherwise unreadable — nothing to peek.
    return { ...outcome, readyNoBody: true };
  }
  if (onReader) onReader(reader);

  try {
    const firstChunk = await reader.read();
    if (!firstChunk || firstChunk.done || !firstChunk.value || !firstChunk.value.length) {
      // Provider closed the stream (or sent an empty chunk) without a token.
      return {
        ok: false, result: res, modelStr: outcome.modelStr, reader,
        errorText: "stream ended before first token", status: res.status, shouldFallback: true,
      };
    }
    return { ...outcome, reader, firstChunk, ttftMs: Date.now() - t0 };
  } catch (error) {
    return {
      ok: false, result: res, modelStr: outcome.modelStr, reader,
      errorText: error?.message || String(error), status: res.status, shouldFallback: true,
    };
  }
}

// Best-effort cancel of a raced attempt that may or may not hold a reader:
// reader.cancel() covers streams mid-peek; cancelOutcome covers responses that
// only resolved (headers) after the race had already ended.
function cancelTokenOutcome(outcome) {
  if (!outcome) return;
  if (outcome.reader) {
    try { outcome.reader.cancel(); } catch { /* ignore */ }
    return;
  }
  if (!outcome.readyNoBody) cancelOutcome(outcome);
}

/**
 * Streaming-aware race: resolve with the first attempt that produces an actual
 * first token, not merely HTTP headers. Bounded by a global firstTokenTimeoutMs
 * deadline across both the headers wait and the token wait; on expiry the
 * raced attempts are canceled and { failures, timedOut } is returned so the
 * caller can fall back through the rest of the combo sequentially.
 *
 * Winner handling differs from raceComboAttempts: the winner's body has been
 * peeked (one chunk consumed via reader), so the caller must rebuild its
 * stream via resumeFirstTokenStream before handing the response to the client.
 */
async function raceToFirstToken(attempts, { firstTokenTimeoutMs = HYBRID_FIRST_TOKEN_TIMEOUT_MS, log } = {}) {
  const t0 = Date.now();
  const deadlineAt = firstTokenTimeoutMs > 0 ? t0 + firstTokenTimeoutMs : Infinity;

  const readers = new Map(); // attempt index -> acquired body reader (cancel hook)
  let raceOver = false;
  let winnerIndex = -1;
  const tokenized = attempts.map((attempt, i) =>
    attemptToFirstToken(attempt, t0, (reader) => {
      if (raceOver) {
        // Race already ended — this response arrived too late to compete.
        try { reader.cancel(); } catch { /* ignore */ }
        return;
      }
      readers.set(i, reader);
    })
  );
  const pending = new Map(tokenized.map((p, i) => [i, p]));
  const failures = new Array(attempts.length);
  let winner = null;
  let timedOut = false;
  let deadlineTimer = null;

  while (pending.size > 0) {
    const racers = [...pending.entries()].map(async ([idx, p]) => ({ i: idx, outcome: await p }));
    if (Number.isFinite(deadlineAt)) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) { timedOut = true; break; }
      racers.push(new Promise((resolve) => { deadlineTimer = setTimeout(() => resolve({ __deadline: true }), remaining); }));
    }
    const raced = await Promise.race(racers);
    if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    if (raced.__deadline) { timedOut = true; break; }
    pending.delete(raced.i);
    if (raced.outcome.ok) { winner = raced.outcome; winnerIndex = raced.i; break; }
    failures[raced.i] = raced.outcome;
  }
  raceOver = true;

  // Cancel the losers: readers we hold resolve their pending first-reads, and
  // the continuation releases responses that only arrive after the race ended.
  for (const [i, reader] of readers) {
    if (i !== winnerIndex) {
      try { reader.cancel(); } catch { /* ignore */ }
    }
  }
  for (const p of pending.values()) {
    Promise.resolve(p).then(cancelTokenOutcome).catch(() => {});
  }

  if (winner) {
    log?.info?.("COMBO", `Hybrid TTFT winner ${winner.modelStr} (first token in ${winner.ttftMs ?? Date.now() - t0}ms)`);
    return { winner };
  }
  if (timedOut) log?.warn?.("COMBO", `Hybrid race: no first token within ${firstTokenTimeoutMs}ms — falling back`);
  return { failures: failures.filter(Boolean), timedOut };
}

/**
 * Rebuild a body stream from a reader the TTFT race peeked one chunk from:
 * replay the peeked chunk, then keep pumping the live reader. Byte-identical
 * to the original stream from the client's perspective.
 */
function resumeFirstTokenStream(reader, firstChunk) {
  return new ReadableStream({
    start(controller) {
      if (firstChunk && firstChunk.value) {
        try { controller.enqueue(firstChunk.value); } catch { /* client gone */ }
      }
      if (!firstChunk || firstChunk.done) {
        try { controller.close(); } catch { /* ignore */ }
        return;
      }
      const pump = () => {
        reader.read().then(
          ({ done, value }) => {
            if (done) { try { controller.close(); } catch { /* ignore */ } return; }
            try { controller.enqueue(value); } catch { /* client gone */ }
            pump();
          },
          (error) => { try { controller.error(error); } catch { /* ignore */ } }
        );
      };
      pump();
    },
    cancel(reason) {
      try { reader.cancel(reason); } catch { /* ignore */ }
    },
  });
}

// Wrap the raced winner in a fresh Response carrying the rebuilt stream.
function rebuildStreamedResponse(res, stream) {
  return new Response(stream, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" | "round-robin" | "hybrid"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @param {number} [options.firstTokenTimeoutMs] - Hybrid streaming race deadline (default 20s; <=0 disables)
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true, firstTokenTimeoutMs = HYBRID_FIRST_TOKEN_TIMEOUT_MS }) {
  // Apply rotation strategy if enabled
  let rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);

  // Auto-switch: float models that satisfy the request's required capabilities to the front.
  if (autoSwitch) {
    const required = detectRequiredCapabilities(body);
    if (required.size > 0) {
      const reordered = reorderByCapabilities(rotatedModels, required);
      if (reordered[0] !== rotatedModels[0]) {
        log.info("COMBO", `auto-switch for [${[...required].join(",")}] → ${reordered[0]}`);
      }
      rotatedModels = reordered;
    }
  }
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  // Record a failed outcome into the shared fallback-aggregation state.
  const recordFailure = (outcome) => {
    if (outcome.retryAfter && (!earliestRetryAfter || new Date(outcome.retryAfter) < new Date(earliestRetryAfter))) {
      earliestRetryAfter = outcome.retryAfter;
    }
    lastError = outcome.errorText || String(outcome.status);
    if (!lastStatus) lastStatus = outcome.status;
  };

  // Hybrid: fire the first two models in parallel and return whichever succeeds
  // first; only if BOTH fail do we fall back through the rest sequentially. This
  // cuts tail latency (a slow/flaky lead model no longer blocks the whole chain)
  // while still preferring the top of the list under normal conditions.
  let startIndex = 0;
  if (comboStrategy === "hybrid" && rotatedModels.length >= 2) {
    const pair = rotatedModels.slice(0, 2);
    log.info("COMBO", `Hybrid race of first 2 models: ${pair.join(", ")}`);
    const attempts = pair.map((modelStr) => ({
      modelStr,
      promise: attemptComboModel(body, modelStr, handleSingleModel),
    }));

    // Streaming requests race to the FIRST TOKEN (a provider that answers 200
    // fast but trickles tokens must not win); non-streaming requests keep the
    // headers race — there is no token stream to peek, and a full-body JSON
    // read inside the race would delay fallback on slow full responses.
    if (body?.stream) {
      const raced = await raceToFirstToken(attempts, { firstTokenTimeoutMs, log });
      if (raced.winner) {
        return rebuildStreamedResponse(
          raced.winner.result,
          resumeFirstTokenStream(raced.winner.reader, raced.winner.firstChunk)
        );
      }
      // Raced pair failed/timed out — record and continue sequentially below.
      for (const outcome of raced.failures) {
        if (!outcome.shouldFallback) {
          log.warn("COMBO", `Hybrid model ${outcome.modelStr} failed (no fallback)`, { status: outcome.status });
          return outcome.result;
        }
        recordFailure(outcome);
        log.warn("COMBO", `Hybrid model ${outcome.modelStr} failed`, { status: outcome.status, error: outcome.errorText });
      }
      startIndex = 2;
    } else {
      const raced = await raceComboAttempts(attempts);
      if (raced.winner) {
        log.info("COMBO", `Hybrid winner: ${raced.winner.modelStr}`);
        return raced.winner.result;
      }

      // Both raced models failed. Honor a hard (non-fallback) error from the
      // earlier model the same way the sequential path would — return it directly.
      for (const outcome of raced.failures) {
        if (!outcome.shouldFallback) {
          log.warn("COMBO", `Hybrid model ${outcome.modelStr} failed (no fallback)`, { status: outcome.status });
          return outcome.result;
        }
        recordFailure(outcome);
        log.warn("COMBO", `Hybrid model ${outcome.modelStr} failed`, { status: outcome.status });
      }
      startIndex = 2;
    }
  }

  for (let i = startIndex; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    const outcome = await attemptComboModel(body, modelStr, handleSingleModel);

    // Success (2xx) - return response
    if (outcome.ok) {
      log.info("COMBO", `Model ${modelStr} succeeded`);
      return outcome.result;
    }

    // Thrown exception — continue to next model
    if (outcome.error) {
      recordFailure(outcome);
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: outcome.errorText });
      continue;
    }

    // Non-fallback error (e.g. bad request) — return it directly
    if (!outcome.shouldFallback) {
      log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: outcome.status });
      return outcome.result;
    }

    // For transient errors (503/502/504), wait for cooldown before falling through
    // so a briefly-overloaded provider gets a chance to recover rather than being
    // skipped immediately (fixes: combo falls through on transient 503)
    if (outcome.cooldownMs && outcome.cooldownMs > 0 && outcome.cooldownMs <= 5000 &&
        (outcome.status === 503 || outcome.status === 502 || outcome.status === 504)) {
      log.info("COMBO", `Model ${modelStr} transient ${outcome.status}, waiting ${outcome.cooldownMs}ms before next`);
      await new Promise(r => setTimeout(r, outcome.cooldownMs));
    }

    // Fallback to next model
    recordFailure(outcome);
    log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: outcome.status });
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  const allDisabled = lastError && lastError.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (lastStatus || 503);
  const msg = lastError || "All combo models unavailable";

  if (earliestRetryAfter) {
    const retryHuman = formatRetryAfter(earliestRetryAfter);
    log.warn("COMBO", `All models failed | ${msg} (${retryHuman})`);
    return unavailableResponse(status, msg, earliestRetryAfter, retryHuman);
  }

  log.warn("COMBO", `All models failed | ${msg}`);
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * Extract assistant text from a non-stream completion across formats
 * (OpenAI chat, Claude messages, Gemini, OpenAI Responses). Returns "" if none.
 * Panel responses are already translated to the client format by chatCore, so the
 * leaf content→string step reuses the translator's own extractTextContent.
 */
function extractPanelText(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI chat completion
  const choice = json.choices?.[0];
  if (choice) {
    const msg = choice.message ?? choice.delta ?? {};
    const t = extractTextContent(msg.content);
    if (t.trim()) return t;
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  // Claude messages (text blocks share OpenAI's {type:"text"} shape)
  const claudeText = extractTextContent(json.content);
  if (claudeText.trim()) return claudeText;

  // Gemini (parts carry .text without a type discriminator)
  const parts = json.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const t = parts.map((p) => p?.text || "").join("");
    if (t.trim()) return t;
  }

  // OpenAI Responses API
  if (Array.isArray(json.output)) {
    const t = json.output
      .flatMap((o) => (Array.isArray(o.content) ? o.content.map((c) => c?.text || "") : []))
      .join("");
    if (t.trim()) return t;
  }

  return "";
}

/**
 * Append a synthesized user turn to whichever message array the request format uses.
 * Preserves the original conversation + system prompt so the judge has full context.
 */
function appendUserTurn(body, text) {
  const next = { ...body };
  if (Array.isArray(body.messages)) {
    next.messages = [...body.messages, { role: "user", content: text }];
  } else if (Array.isArray(body.input)) {
    next.input = [...body.input, { role: "user", content: text }];
  } else if (Array.isArray(body.contents)) {
    next.contents = [...body.contents, { role: "user", parts: [{ text }] }];
  } else {
    next.messages = [{ role: "user", content: text }];
  }
  return next;
}

/**
 * Build the judge directive. Per OpenRouter's Fusion design, the judge does NOT
 * merge — it analyzes (consensus / contradictions / partial coverage / unique
 * insights / blind spots) then writes one answer grounded in that analysis.
 * ~3/4 of fusion's quality lift comes from this synthesis step.
 *
 * Sources are anonymized ("Source N") so the judge weighs substance, not the
 * reputation of a model brand.
 */
function buildJudgePrompt(answers) {
  const panel = answers
    .map((a, i) => `[Source ${i + 1}]\n${a.text}`)
    .join("\n\n");

  return [
    `You are the JUDGE in a model-fusion panel. ${answers.length} expert models independently answered the user's most recent request. Their responses are below, anonymized by source.`,
    "",
    "Do NOT mention that multiple models were used, and do NOT refer to the sources. Produce ONE authoritative final answer addressed directly to the user.",
    "",
    "First, internally analyze the panel along these dimensions: consensus (points most sources agree on — treat as higher-confidence), contradictions (where they disagree — resolve with your own judgment), partial coverage, unique insights only one source surfaced, and blind spots every source missed. Then write the best possible final answer grounded in that analysis — more complete and correct than any single response, with no filler.",
    "",
    "=== PANEL RESPONSES ===",
    panel,
    "=== END PANEL RESPONSES ===",
    "",
    "Now write the final answer to the user's original request.",
  ].join("\n");
}

// Fusion tuning. Overridable per-combo via settings.comboStrategies[name].
const FUSION_DEFAULTS = {
  minPanel: 2,             // answers needed before stragglers get a grace window
  stragglerGraceMs: 8000,  // wait this long for laggards once quorum is reached
  panelHardTimeoutMs: 90000, // absolute cap so one hung model can't stall forever
};

// Resolve a Response (or {__error}) within ms; the loser keeps running but is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ __timeout: true }), ms);
    Promise.resolve(promise)
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); resolve({ __error: e }); });
  });
}

/**
 * Collect panel responses with quorum-grace: as soon as `minPanel` calls succeed,
 * start a short grace timer for the rest, then proceed with whatever arrived. This
 * caps the straggler penalty (the slowest model otherwise dominates wall time) while
 * still preferring a full panel when everyone is fast. Bounded by a hard timeout.
 * Returns a sparse array aligned to `calls` (undefined = not yet / dropped).
 */
function collectPanel(calls, { minPanel, stragglerGraceMs, panelHardTimeoutMs }) {
  return new Promise((resolve) => {
    const out = new Array(calls.length);
    let settled = 0;
    let ok = 0;
    let finished = false;
    let graceTimer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(hardTimer);
      if (graceTimer) clearTimeout(graceTimer);
      resolve(out);
    };
    const hardTimer = setTimeout(finish, panelHardTimeoutMs);
    calls.forEach((p, i) => {
      Promise.resolve(p)
        .then((v) => { out[i] = v; })
        .catch((e) => { out[i] = { __error: e }; })
        .finally(() => {
          settled++;
          if (out[i] && out[i].ok) ok++;
          if (settled === calls.length) return finish();
          if (ok >= minPanel && !graceTimer) graceTimer = setTimeout(finish, stragglerGraceMs);
        });
    });
  });
}

/**
 * Handle a fusion combo: fan the prompt out to every panel model in parallel,
 * then a judge model synthesizes one final answer from all panel responses.
 *
 * Panel calls are forced non-streaming with tools stripped (the judge needs
 * complete prose to synthesize). The judge call keeps the client's original
 * stream flag + tools, so streaming and downstream tool use still work.
 *
 * Speed: quorum-grace collection caps the straggler penalty. Quality: the judge
 * runs the consensus/contradiction/blind-spot analysis before writing.
 *
 * Degrades gracefully: 0 panel answers -> 503, exactly 1 -> return it directly.
 *
 * @param {Object} options
 * @param {Object} options.body - Request body (client format)
 * @param {string[]} options.models - Panel model strings
 * @param {Function} options.handleSingleModel - (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger
 * @param {string} [options.comboName] - Combo name (logging)
 * @param {string} [options.judgeModel] - Judge model; falls back to panel[0]
 * @param {Object} [options.tuning] - Override FUSION_DEFAULTS (minPanel, grace, timeout)
 * @returns {Promise<Response>}
 */
export async function handleFusionChat({ body, models, handleSingleModel, log, comboName, judgeModel, tuning }) {
  const panel = Array.isArray(models) ? models.filter(Boolean) : [];
  if (panel.length === 0) {
    return new Response(
      JSON.stringify({ error: { message: "Fusion combo has no models" } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // A single-model fusion has nothing to fuse — just answer directly.
  if (panel.length === 1) {
    return handleSingleModel(body, panel[0]);
  }

  const cfg = { ...FUSION_DEFAULTS, ...(tuning || {}) };
  const minPanel = Math.min(Math.max(2, cfg.minPanel), panel.length);
  const judge = judgeModel && judgeModel.trim() ? judgeModel.trim() : panel[0];
  log.info("FUSION", `Combo "${comboName}" | panel=${panel.length} [${panel.join(", ")}] | judge=${judge} | quorum=${minPanel}`);

  // 1. Fan out to the panel in parallel: non-streaming, tools stripped (we want prose).
  const { tools, tool_choice, stream_options, ...rest } = body;
  // Fusion runs panel models non-streaming; drop stream_options too, or providers
  // like DeepSeek reject it with "stream_options should be set along with stream = true".
  // See issue #3024.
  const panelBody = { ...rest, stream: false };

  // Flatten tool turns to prose so panel models keep context without emitting tool_calls.
  if (Array.isArray(panelBody.messages)) {
    panelBody.messages = flattenToolHistory(panelBody.messages);
  } else if (Array.isArray(panelBody.input)) {
    panelBody.input = flattenToolHistory(panelBody.input);
  }

  const t0 = Date.now();
  const calls = panel.map((m) => withTimeout(handleSingleModel(panelBody, m, true), cfg.panelHardTimeoutMs));
  const settled = await collectPanel(calls, { ...cfg, minPanel });
  log.info("FUSION", `fan-out collected in ${Date.now() - t0}ms`);

  // 2. Collect successful answers.
  const answers = [];
  for (let i = 0; i < settled.length; i++) {
    const res = settled[i];
    const model = panel[i];
    if (!res) { log.warn("FUSION", `Panel ${model} dropped (straggler/timeout)`); continue; }
    if (res.__timeout) { log.warn("FUSION", `Panel ${model} timed out`); continue; }
    if (res.__error) { log.warn("FUSION", `Panel ${model} threw`, { error: res.__error?.message || String(res.__error) }); continue; }
    if (!res.ok) { log.warn("FUSION", `Panel ${model} failed`, { status: res.status }); continue; }
    try {
      const json = await res.clone().json();
      const text = extractPanelText(json);
      if (text) {
        answers.push({ model, text });
        log.info("FUSION", `Panel ${model} ok (${text.length} chars)`);
      } else {
        log.warn("FUSION", `Panel ${model} returned empty content`);
      }
    } catch (e) {
      log.warn("FUSION", `Panel ${model} unparseable`, { error: e.message || String(e) });
    }
  }

  // 3. Degrade gracefully when the panel is too thin to fuse.
  if (answers.length === 0) {
    log.warn("FUSION", "All panel models failed");
    return new Response(
      JSON.stringify({ error: { message: "All fusion panel models failed" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
  if (answers.length === 1) {
    log.info("FUSION", `Only ${answers[0].model} succeeded — answering directly (no fusion)`);
    return handleSingleModel(body, answers[0].model);
  }

  // 4. Judge analyzes + writes one final answer (streams to client if requested).
  const judgeBody = appendUserTurn(body, buildJudgePrompt(answers));
  log.info("FUSION", `Judging ${answers.length} answers with ${judge}`);
  return handleSingleModel(judgeBody, judge);
}
