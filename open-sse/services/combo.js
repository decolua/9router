/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { isModelCoolingDown, markModelCooldownFrom, modelCooldownRemaining } from "./modelCooldown.js";
import { isQuotaExhausted, isQuotaExhaustion, markQuotaExhausted, quotaRemainingMs } from "./quotaState.js";
import { demoteUnhealthy, recordModelFailure, recordModelSuccess } from "./modelHealth.js";
import { unavailableResponse } from "../utils/error.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { extractTextContent } from "../translator/formats/gemini.js";
import { estimateInputTokens } from "../utils/usageTracking.js";
import { extractVisibleText, findDegeneracy, hasAssistantPrefill, GATE_WINDOW_CHARS, GATE_MIN_JUDGEABLE_CHARS, PREFLIGHT_MAX_READS, HOLD_BACK_MS } from "../utils/degeneracy.js";

// Hard capabilities = input modalities; missing one drops request data (e.g. image
// stripped). Must be prioritized. Soft (e.g. search) only degrades a feature.
const HARD_CAPS = new Set(["vision", "pdf", "audioInput", "videoInput"]);

// Statuses that mean "come back later", as opposed to "this request is wrong".
// Clients and agent loops branch on exactly this distinction.
function isRetryableStatus(status) {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

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

async function preflightSseResponse(response, isPrefill = false) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.toLowerCase().includes("text/event-stream")) return response;

  const reader = response.body.getReader();
  try {
    let first;
    do {
      first = await reader.read();
    } while (!first.done && (!first.value || first.value.byteLength === 0));

    if (first.done) throw new Error("stream ended before first event");

    // Hold-back window. Nothing has reached the client yet, so this is the last
    // point at which a bad answer can still be replaced by a different model's.
    // Read a little further than the first chunk — enough visible text to judge
    // the opening — then decide. Everything read is replayed, so a stream that
    // passes is delivered byte-for-byte.
    const held = [first.value];
    let visible = "";
    let decodedUpTo = 0;
    let reads = 0;
    const decoder = new TextDecoder();
    let sseTail = "";

    // An error met while reading ahead is replayed to the client, never turned
    // into a cascade. Reading ahead is our doing, not the client's: the first
    // chunk arrived intact, and re-running the model from here would repeat work
    // the upstream has already charged for. Only a failure *before* the first
    // chunk cascades, which is the invariant the preflight had to begin with.
    let readAheadError = null;
    // A read left in flight when the budget expires. A reader permits one read
    // at a time, so it has to be carried into the replay rather than abandoned.
    let pendingRead = null;
    let streamDone = false;

    // Three bounds, because the judging window sits in front of every streamed
    // response and must never become a stall: a chunk budget, a wall-clock
    // budget, and stopping the moment there is enough text to judge. The clock
    // only runs when the stream actually pauses — back-to-back chunks resolve
    // immediately and cost nothing.
    const deadline = Date.now() + HOLD_BACK_MS;
    const TIMED_OUT = Symbol("timed-out");

    while (reads < PREFLIGHT_MAX_READS) {
      while (decodedUpTo < held.length) {
        sseTail += decoder.decode(held[decodedUpTo++], { stream: true });
      }
      const lines = sseTail.split("\n");
      sseTail = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const text = extractVisibleText(JSON.parse(payload));
          if (text) visible += text;
        } catch { /* a frame we cannot read is not evidence of anything */ }
      }

      if (visible.trim().length >= GATE_MIN_JUDGEABLE_CHARS || visible.length >= GATE_WINDOW_CHARS) break;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      reads++;
      const inFlight = reader.read();
      let timer;
      let next;
      try {
        next = await Promise.race([
          inFlight,
          new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), remaining); }),
        ]);
      } catch (error) {
        readAheadError = error;
        break;
      } finally {
        clearTimeout(timer);
      }

      if (next === TIMED_OUT) { pendingRead = inFlight; break; }
      if (next.done) { streamDone = true; break; }
      if (next.value?.byteLength) held.push(next.value);
    }

    // Only judge what was actually read cleanly. A stream that errored or that
    // produced no prose has told us nothing about how it opens.
    const degeneracy = visible && !readAheadError && !isPrefill ? findDegeneracy(visible) : null;
    if (degeneracy) {
      const failure = new Error(`degenerate opening: ${degeneracy}`);
      failure.comboFallbackStatus = 502;
      throw failure;
    }

    let queue = held;
    let buffered = null;
    return new Response(new ReadableStream({
      async pull(controller) {
        if (queue && queue.length > 0) {
          controller.enqueue(queue.shift());
          if (queue.length === 0) queue = null;
          return;
        }
        if (buffered) {
          controller.enqueue(buffered);
          buffered = null;
          return;
        }
        // Everything held has now been delivered, so whatever ended the judging
        // window is replayed in the position it would have occupied anyway.
        if (readAheadError) {
          const error = readAheadError;
          readAheadError = null;
          await reader.cancel(error).catch(() => {});
          // Errors rather than closes, unlike the branch below, and the
          // difference is deliberate. combo-stream-fallback.test.js pins that a
          // stream which delivered its first chunk and then aborted surfaces the
          // abort to the client instead of being silently truncated or retried.
          // Review suggested unifying on the clean close; that test is the
          // authority, and a silent truncation here would look like a complete
          // answer that simply stopped.
          controller.error(error);
          return;
        }
        if (streamDone) { controller.close(); return; }
        if (pendingRead) {
          const inFlight = pendingRead;
          pendingRead = null;
          try {
            const { done, value } = await inFlight;
            if (done) controller.close();
            else controller.enqueue(value);
          } catch (error) {
            await reader.cancel(error).catch(() => {});
            controller.error(error);
          }
          return;
        }
        try {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          await reader.cancel(error).catch(() => {});
          // Clean close, never error: a controller.error() here terminates the
          // ReadableStream with an error that the harness wraps as [CommandCode
          // error: "Upstream stream ended before terminal chunk"], leaking
          // transport noise into visible output. controller.close() is the SSE
          // equivalent of `data: [DONE]` — harness never wraps it.
          // (2026-08-03, inyund fork)
          controller.close();
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      }
    }), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    const failure = new Error(error?.message || "SSE preflight failed", { cause: error });
    failure.comboFallbackStatus = 502;
    throw failure;
  }
}

/**
 * The one place a combo entry is passed over without being tried.
 *
 * Returns null to attempt the model, or `{ reason }` naming why it was skipped —
 * the caller logs it. Every skip rule lives here so that "the combo answered from
 * its last entry" is a diagnosable event instead of a silent one: three rules
 * deciding independently in-line is how a healthy provider disappears from a
 * cascade with nothing in the log to say so.
 *
 * `canServe` is the authority when supplied. The quota/cooldown maps below are a
 * per-model guess held in one process; the caller's account layer knows which
 * individual accounts are locked and until when. A guess must never outlive the
 * fact: if any account can serve the model right now, we try it, whatever an
 * earlier account's 429 wrote into the map. Without `canServe` (open-sse used
 * standalone, no account layer) the maps stand on their own as before.
 *
 * The probe answers `null` when it has no opinion — a no-auth free provider with
 * no per-account state to track, or one with nothing configured. Silence is not
 * capacity: in that case the maps below are the only thing standing between the
 * cascade and a round trip it already knows will fail, so they still decide.
 *
 * @param {string} modelStr - Combo entry, e.g. "ag/gemini-3.1-pro-low"
 * @param {Object} ctx
 * @param {number} [ctx.inputTokens] - Estimated tokens in the request
 * @param {(modelStr: string) => Promise<{serveable: boolean, retryAfter?: string}|null>} [ctx.canServe]
 *   Account-layer probe: has any account capacity for this model? `null` = no opinion.
 * @returns {Promise<{ reason: string, retryAfter?: string }|null>}
 */
export async function shouldSkipModel(modelStr, { inputTokens = 0, canServe = null } = {}) {
  const slash = modelStr.indexOf("/");
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;

  // Only the input is weighed against the input window. The output budget is a
  // separate allowance upstream, so counting it here silently removes big-window
  // models from long conversations. If a provider really does share one budget,
  // it says so upstream and the cascade falls through on a real answer.
  const contextWindow = getCapabilitiesForModel(provider, model).contextWindow;
  if (contextWindow && inputTokens > contextWindow) {
    return { reason: `request needs ~${inputTokens} tokens but window is ${contextWindow}` };
  }

  if (canServe) {
    let verdict = null;
    try {
      verdict = await canServe(modelStr);
    } catch {
      verdict = null; // probe broke: fall back to local memory rather than guess
    }
    if (verdict) {
      if (verdict.serveable) return null;
      return {
        reason: "no account has capacity for it right now",
        retryAfter: verdict.retryAfter || null,
      };
    }
  }

  // Quota exhaustion outlives a cooldown by hours — skip rather than spend a
  // request rediscovering it. If every model is out, the cascade still falls
  // through to the normal exhausted path.
  if (isQuotaExhausted(modelStr)) {
    return { reason: `quota exhausted for ${Math.round(quotaRemainingMs(modelStr) / 60000)}m` };
  }

  // A model that told us to back off is skipped until its window elapses —
  // retrying it only spends a round trip to be told the same thing again.
  if (isModelCoolingDown(modelStr)) {
    return { reason: `cooling down for ${Math.round(modelCooldownRemaining(modelStr) / 1000)}s` };
  }

  return null;
}

/**
 * Handle combo chat with fallback
 * @param {Object} options
 * @param {Object} options.body - Request body
 * @param {string[]} options.models - Array of model strings to try
 * @param {Function} options.handleSingleModel - Function to handle single model: (body, modelStr) => Promise<Response>
 * @param {Object} options.log - Logger object
 * @param {string} [options.comboName] - Name of the combo (for round-robin tracking)
 * @param {string} [options.comboStrategy] - Strategy: "fallback" or "round-robin"
 * @param {number|string} [options.comboStickyLimit=1] - Requests per combo model before switching
 * @param {Function} [options.canServe] - (modelStr) => boolean: does any account still
 *   have capacity for this model? Supplied by the app's account layer; when omitted the
 *   cascade falls back to its own per-model quota/cooldown memory.
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1, autoSwitch = true, canServe = null }) {
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

  // Health-aware demotion, applied last so it wins over rotation but never over
  // a capability requirement being unmet — sick models move to the back, none
  // are dropped, so a combo whose models are all sick still tries them all.
  const healthOrdered = demoteUnhealthy(rotatedModels);
  if (healthOrdered !== rotatedModels) {
    log.info("COMBO", `health demotion → trying ${healthOrdered[0]} first`);
    rotatedModels = healthOrdered;
  }
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;
  // The most recent failure a client should come back from. Kept beside the last
  // failure so a permanent-looking code from a trailing entry cannot bury the
  // fact that an earlier one was merely busy.
  let lastRetryable = null;
  const inputTokens = estimateInputTokens(body);

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];

    // Skipped entries are warn, not info: a combo quietly answering from its last
    // entry because the earlier ones were never attempted is the failure mode this
    // level of logging exists to make visible.
    const skip = await shouldSkipModel(modelStr, { inputTokens, canServe });
    if (skip) {
      log.warn("COMBO", `Skipping ${modelStr}, ${skip.reason}`);
      if (skip.retryAfter && (!earliestRetryAfter || new Date(skip.retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = skip.retryAfter;
      }
      // A skipped entry is still a reason the request failed. Recording it keeps
      // the all-failed response from degrading to a bare 503 with no detail and
      // no Retry-After when every entry was skipped rather than tried. A real
      // attempt's error is more informative, so it overwrites this below.
      if (!lastError) {
        lastError = `[${modelStr}] ${skip.reason}`;
        lastStatus = 503;
        lastRetryable = { status: lastStatus, error: lastError };
      }
      continue;
    }
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      // Third arg is the cascade position (0 = first choice), recorded as
      // usageHistory.chainDepth. handleFusionChat's callback uses a third arg
      // for isPanel, but that is a separate closure — this one is only ever
      // paired with handleComboChat's (b, m) callback.
      const result = await handleSingleModel(body, modelStr, i);

      // Success (2xx) - verify an SSE stream produces data before committing to it.
      if (result.ok) {
        const ready = await preflightSseResponse(result, hasAssistantPrefill(body));
        log.info("COMBO", `Model ${modelStr} succeeded`);
        recordModelSuccess(modelStr);
        return ready;
      }

      // Extract error info from response
      let errorText = result.statusText || "";
      let retryAfter = null;
      let accountsLocked = false;
      try {
        const errorBody = await result.clone().json();
        errorText = errorBody?.error?.message || errorBody?.error || errorBody?.message || errorText;
        retryAfter = errorBody?.retryAfter || null;
        accountsLocked = errorBody?.accountsLocked === true;
      } catch {
        // Ignore JSON parse errors
      }

      // Track earliest retryAfter across all combo models
      if (retryAfter && (!earliestRetryAfter || new Date(retryAfter) < new Date(earliestRetryAfter))) {
        earliestRetryAfter = retryAfter;
      }

      // Normalize error text to string (Worker-safe)
      if (typeof errorText !== "string") {
        try { errorText = JSON.stringify(errorText); } catch { errorText = String(errorText); }
      }

      // Check if should fallback to next model
      const { shouldFallback, cooldownMs } = checkFallbackError(result.status, errorText);

      // `accountsLocked` marks our own reply, synthesized when the account layer
      // found every account locked. It quotes the provider's original text, so
      // reading it back as a fresh verdict lets one provider 429 renew its own
      // ban indefinitely. The account layer already holds the real expiry — the
      // per-model memory below stays out of it.
      if (!accountsLocked) {
        // Remember it for subsequent requests, not just this cascade.
        markModelCooldownFrom(modelStr, retryAfter, cooldownMs);
        // Bound the ban by the provider's own reset time when it gave one; the
        // default hour is a guess, and a guess should not outlive the fact.
        if (isQuotaExhaustion(result.status, errorText)) {
          // Only a reset time in the future replaces the default window. A value
          // that parses to the past — or to an epoch offset, as a bare
          // `retryAfter: 30` does — would otherwise store an already-expired ban,
          // which is no ban at all.
          const until = retryAfter ? new Date(retryAfter).getTime() : NaN;
          const ttlMs = until > Date.now() ? until - Date.now() : undefined;
          markQuotaExhausted(modelStr, Date.now(), ttlMs);
        }
      }
      recordModelFailure(modelStr);

      if (!shouldFallback) {
        log.warn("COMBO", `Model ${modelStr} failed (no fallback)`, { status: result.status });
        return result;
      }

      // For transient errors (503/502/504), wait for cooldown before falling through
      // so a briefly-overloaded provider gets a chance to recover rather than being
      // skipped immediately (fixes: combo falls through on transient 503)
      if (cooldownMs && cooldownMs > 0 && cooldownMs <= 5000 &&
          (result.status === 503 || result.status === 502 || result.status === 504)) {
        log.info("COMBO", `Model ${modelStr} transient ${result.status}, waiting ${cooldownMs}ms before next`);
        await new Promise(r => setTimeout(r, cooldownMs));
      }

      // Fallback to next model. Status and message move together: they describe
      // one failure, and keeping the first status beside the last message hands
      // the client a code from one provider explaining another provider's error.
      lastError = errorText || String(result.status);
      lastStatus = result.status;
      if (isRetryableStatus(lastStatus)) lastRetryable = { status: lastStatus, error: lastError };
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = error.message || String(error);
      lastStatus = error.comboFallbackStatus || 500;
      if (isRetryableStatus(lastStatus)) lastRetryable = { status: lastStatus, error: lastError };
      // Score throw-class failures too. The returned-Response path records at
      // the status branch above; without this, a model whose failure mode is
      // "HTTP 200 then the stream ends before the first event" (preflight
      // throws with comboFallbackStatus 502) stays permanently healthy and
      // keeps winning first place over models that fail honestly.
      recordModelFailure(modelStr);
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
  }

  // All models failed
  // Use 503 (Service Unavailable) rather than 406 (Not Acceptable) — 406 implies
  // the request itself is invalid, but here the providers are simply unavailable
  // or have no active credentials. 503 is more accurate and retryable by clients.
  // Quote a failure the client can act on. A 400 from the last entry ends an
  // agent loop that a 429 from an earlier one would have survived, so when the
  // trailing failure looks permanent but an earlier one was transient, the
  // transient one is reported — status and message together, still one failure.
  const quoted = (lastRetryable && !isRetryableStatus(lastStatus))
    ? lastRetryable
    : { status: lastStatus, error: lastError };

  const allDisabled = quoted.error && quoted.error.toLowerCase().includes("no credentials");
  const status = allDisabled ? 503 : (quoted.status || 503);
  const msg = quoted.error || "All combo models unavailable";

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
