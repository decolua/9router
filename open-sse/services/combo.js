/**
 * Shared combo (model combo) handling with fallback support
 */

import { checkFallbackError, formatRetryAfter } from "./accountFallback.js";
import { unavailableResponse } from "../utils/error.js";

const EMPTY_TOOL_STREAM_STATUS = 502;

/**
 * Track rotation state per combo (for round-robin strategy)
 * @type {Map<string, { index: number, consecutiveUseCount: number }>}
 */
const comboRotationState = new Map();

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

function requestHasTools(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0;
}

function isInspectableSseResponse(response) {
  const contentType = response?.headers?.get?.("content-type") || "";
  return response?.ok && response?.body && typeof response.clone === "function" && contentType.includes("text/event-stream");
}

function parseSsePayloads(text) {
  const messages = String(text || "").split(/\r?\n\r?\n/);
  const payloads = [];

  for (const msg of messages) {
    if (!msg.trim()) continue;
    const eventMatch = msg.match(/^event:\s*(.+)$/m);
    const dataMatch = msg.match(/^data:\s*(.+)$/m);
    if (!dataMatch) continue;

    const data = dataMatch[1].trim();
    if (!data || data === "[DONE]") continue;

    try {
      payloads.push({ event: eventMatch?.[1]?.trim() || "", data: JSON.parse(data) });
    } catch {
      payloads.push({ event: eventMatch?.[1]?.trim() || "", malformed: true });
    }
  }

  return payloads;
}

function payloadHasVisibleOutput({ event, data }) {
  if (!data || typeof data !== "object") return false;

  const choice = data.choices?.[0];
  const delta = choice?.delta;
  if (delta?.content || delta?.reasoning_content) return true;
  if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) return true;
  if (choice?.message?.content) return true;
  if (Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0) return true;

  if (data.type === "content_block_start" && data.content_block?.type === "tool_use") return true;
  if (data.type === "content_block_delta" && (data.delta?.text || data.delta?.partial_json || data.delta?.thinking)) return true;
  if (event === "response.output_text.delta" && data.delta) return true;
  if (event === "response.reasoning_summary_text.delta" && data.delta) return true;
  if (event === "response.output_item.added" && (data.item?.type === "function_call" || data.item?.type === "custom_tool_call")) return true;
  if ((event === "response.function_call_arguments.delta" || event === "response.custom_tool_call_input.delta") && data.delta) return true;

  return false;
}

async function inspectToolStreamForFallback(response) {
  if (!isInspectableSseResponse(response)) return null;

  const clone = response.clone();
  const reader = clone.body?.getReader?.();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffer = "";
  let sawMalformedPayload = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";

      for (const payload of parseSsePayloads(parts.join("\n\n"))) {
        if (payload.malformed) sawMalformedPayload = true;
        if (payloadHasVisibleOutput(payload)) {
          reader.cancel().catch(() => { });
          return null;
        }
      }
    }
  } catch (error) {
    return { shouldFallback: false, reason: `stream inspection failed: ${error.message || String(error)}` };
  }

  const remaining = buffer + decoder.decode();
  const payloads = parseSsePayloads(remaining);
  const hasVisibleOutput = payloads.some(payloadHasVisibleOutput);
  const hasMalformedPayload = sawMalformedPayload || payloads.some(p => p.malformed);

  // #1382: Some OpenAI-compatible backends return HTTP 200 SSE streams for
  // tool-heavy Claude requests but emit no client-visible text/tool calls. Treat
  // those as transient upstream failures so combos can try the next model.
  if (!hasVisibleOutput) {
    return {
      shouldFallback: true,
      reason: hasMalformedPayload ? "malformed tool stream with no visible output" : "empty tool stream with no visible output"
    };
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
 * @returns {Promise<Response>}
 */
export async function handleComboChat({ body, models, handleSingleModel, log, comboName, comboStrategy, comboStickyLimit = 1 }) {
  // Apply rotation strategy if enabled
  const rotatedModels = getRotatedModels(models, comboName, comboStrategy, comboStickyLimit);
  
  let lastError = null;
  let earliestRetryAfter = null;
  let lastStatus = null;

  for (let i = 0; i < rotatedModels.length; i++) {
    const modelStr = rotatedModels[i];
    log.info("COMBO", `Trying model ${i + 1}/${rotatedModels.length}: ${modelStr}`);

    try {
      const result = await handleSingleModel(body, modelStr);
      
      // Success (2xx) - return response
      if (result.ok) {
        if (requestHasTools(body)) {
          const streamIssue = await inspectToolStreamForFallback(result);
          if (streamIssue?.shouldFallback) {
            lastError = streamIssue.reason;
            if (!lastStatus) lastStatus = EMPTY_TOOL_STREAM_STATUS;
            log.warn("COMBO", `Model ${modelStr} returned empty tool stream, trying next`, { status: EMPTY_TOOL_STREAM_STATUS });
            continue;
          }
        }
        log.info("COMBO", `Model ${modelStr} succeeded`);
        return result;
      }

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

      // Fallback to next model
      lastError = errorText || String(result.status);
      if (!lastStatus) lastStatus = result.status;
      log.warn("COMBO", `Model ${modelStr} failed, trying next`, { status: result.status });
    } catch (error) {
      // Catch unexpected exceptions to ensure fallback continues
      lastError = error.message || String(error);
      if (!lastStatus) lastStatus = 500;
      log.warn("COMBO", `Model ${modelStr} threw error, trying next`, { error: lastError });
    }
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
