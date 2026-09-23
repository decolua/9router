/**
 * Jev / System One routing classifier.
 *
 * Provider-neutral: the caller injects `evaluateSystemone(payload, model)`. In
 * the app this invokes 9router's existing handleSystemone() path in-process, so
 * OpenCode, OpenRouter, Vercel, and future System One providers reuse normal
 * credential fallback and usage accounting.
 *
 * Fail-open: any error, timeout, malformed response, unknown tier, or low
 * confidence returns null and preserves the combo's existing order.
 */

import { trailingUserItems } from "./combo.js";
import { extractTextContent } from "../translator/formats/gemini.js";
import {
  JEV_DEFAULT_CLASSIFIER_MODEL,
  JEV_TIERS,
  JEV_DEFAULT_CRITERIA,
  JEV_DEFAULT_INSTRUCTIONS,
  JEV_STATE_CHAR_BUDGET,
  JEV_TIMEOUT_MS,
  JEV_BREAKER_COOLDOWN_MS,
  JEV_MIN_CONFIDENCE,
} from "../config/jev.js";

// Per-model breaker: a bad OpenRouter lane must not suppress healthy OpenCode
// or Vercel lanes.
const breakers = new Map();

/** Test/reset hook: clear one classifier breaker, or all when omitted. */
export function resetJevBreaker(classifierModel) {
  if (classifierModel) breakers.delete(classifierModel);
  else breakers.clear();
}

function breakerOpen(classifierModel, now) {
  const state = breakers.get(classifierModel);
  if (!state) return false;
  if (now < state.openUntil) return true;
  if (!state.halfOpen) {
    state.halfOpen = true;
    return false;
  }
  return true;
}

function tripBreaker(classifierModel, now, cooldownMs) {
  breakers.set(classifierModel, { openUntil: now + cooldownMs, halfOpen: false });
}

/** Build a bounded state from the current user turn only. */
export function buildJevState(body, charBudget = JEV_STATE_CHAR_BUDGET) {
  if (!body || typeof body !== "object") return "";
  const parts = [];
  const pushText = (text) => {
    if (typeof text === "string" && text.trim()) parts.push(text.trim());
  };

  for (const message of trailingUserItems(body.messages)) pushText(extractTextContent(message?.content));
  for (const item of trailingUserItems(body.input)) pushText(extractTextContent(item?.content));
  const contents = body.contents || body.request?.contents;
  for (const content of trailingUserItems(contents)) {
    if (Array.isArray(content?.parts)) for (const part of content.parts) pushText(part?.text);
  }

  return parts.join("\n").slice(0, charBudget);
}

function evaluateWithTimeout(evaluateSystemone, payload, classifierModel, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
    Promise.resolve(evaluateSystemone(payload, classifierModel))
      .then((value) => { clearTimeout(timer); resolve({ value }); })
      .catch((error) => { clearTimeout(timer); resolve({ error }); });
  });
}

/** Classify a chat request into SIMPLE / MEDIUM / COMPLEX / REASONING. */
export async function classifyTier(opts = {}) {
  const {
    body,
    evaluateSystemone,
    classifierModel = JEV_DEFAULT_CLASSIFIER_MODEL,
    log = { info() {}, warn() {}, debug() {} },
    criteria = JEV_DEFAULT_CRITERIA,
    instructions = JEV_DEFAULT_INSTRUCTIONS,
    timeoutMs = JEV_TIMEOUT_MS,
    minConfidence = JEV_MIN_CONFIDENCE,
    breakerEnabled = true,
    now = () => Date.now(),
  } = opts;

  const t0 = now();
  if (typeof evaluateSystemone !== "function") {
    log.debug?.("JEV", "no System One evaluator — skipping classifier (fail-open)");
    return null;
  }

  const state = buildJevState(body);
  if (!state) {
    log.debug?.("JEV", "empty state — skipping classifier (fail-open)");
    return null;
  }

  if (breakerEnabled && breakerOpen(classifierModel, t0)) {
    log.debug?.("JEV", `circuit breaker open for ${classifierModel} — skipping classifier`);
    return null;
  }

  const payload = {
    state,
    questions: { tier: { type: "choice", instructions, criteria } },
  };

  let response;
  try {
    const result = await evaluateWithTimeout(
      evaluateSystemone,
      payload,
      classifierModel,
      timeoutMs
    );
    if (result?.__timeout) {
      if (breakerEnabled) tripBreaker(classifierModel, now(), JEV_BREAKER_COOLDOWN_MS);
      log.warn?.("JEV", `${classifierModel} classifier timed out — fail-open`);
      return null;
    }
    if (result?.error) {
      log.warn?.("JEV", `${classifierModel} classifier error — fail-open: ${result.error?.message || result.error}`);
      return null;
    }
    response = result?.value;
  } catch (error) {
    log.warn?.("JEV", `${classifierModel} classifier error — fail-open: ${error?.message || error}`);
    return null;
  }

  if (!response?.ok) {
    log.warn?.("JEV", `${classifierModel} classifier HTTP ${response?.status} — fail-open`);
    return null;
  }

  let json;
  try {
    json = await response.json();
  } catch (error) {
    log.warn?.("JEV", `${classifierModel} returned invalid JSON — fail-open: ${error?.message || error}`);
    return null;
  }

  const answer = json?.answers?.tier;
  const tier = answer?.choice;
  const confidence = typeof answer?.confidence === "number" ? answer.confidence : null;
  const probabilities = answer?.probabilities && typeof answer.probabilities === "object"
    ? answer.probabilities
    : null;

  if (!tier || !JEV_TIERS.includes(tier)) {
    log.warn?.("JEV", `${classifierModel} returned unknown tier "${tier}" — fail-open`);
    return null;
  }
  if (confidence == null || confidence < minConfidence) {
    log.info?.("JEV", `${classifierModel} low confidence (${confidence}) for ${tier} — keeping order`);
    return null;
  }

  if (breakerEnabled) breakers.delete(classifierModel);
  const elapsed = now() - t0;
  log.info?.("JEV", `${classifierModel} tier=${tier} conf=${confidence.toFixed(3)} in ${elapsed}ms`);

  return {
    tier,
    confidence,
    probabilities,
    model: json?.model || classifierModel,
    usage: json?.usage || null,
    source: "systemone",
  };
}
