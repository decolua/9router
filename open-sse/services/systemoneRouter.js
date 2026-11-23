/**
 * Pure System One router utilities for intelligent combo model selection.
 * Used by the "smart" combo strategy to pick the best model for a request
 * before generation begins, with session stickiness for prompt-cache retention.
 */

export const DEFAULT_SYSTEMONE_ROUTER_MODEL = "oc/jev-1.13-free";
export const DEFAULT_SYSTEMONE_TIMEOUT_MS = 8000;
export const MAX_STATE_CHARS = 2000;
export { MAX_STICKY_SESSIONS, STICKY_SESSION_TTL_MS } from "../config/sessionAffinity.js";
export { getStickyComboModel, setStickyComboModel, clearStickyComboSession, pruneStickyComboSessions, resetStickyComboStore } from "./comboSession.js";

/**
 * Extract prompt text from the request body for System One classification.
 * Takes the last user turn (or prompt) and truncates to avoid token waste.
 *
 * @param {object} body - Request body
 * @param {number} [maxChars=MAX_STATE_CHARS] - Max character cap
 * @returns {string} Clean prompt state
 */
export function extractPromptState(body, maxChars = MAX_STATE_CHARS) {
  if (!body || typeof body !== "object") return "";

  // Messages array (OpenAI / Claude / etc.) or input array (Codex)
  const messages = Array.isArray(body.messages)
    ? body.messages
    : (Array.isArray(body.input) ? body.input : null);

  if (messages && messages.length > 0) {
    // Find the latest user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "user" || msg?.type === "message" || (!msg?.role && msg?.content)) {
        const text = extractTextFromContent(msg.content ?? msg.text);
        if (text && text.trim().length > 0) {
          return text.trim().slice(0, maxChars);
        }
      }
    }
    // Fallback: latest message of any role
    const lastMsg = messages[messages.length - 1];
    const text = extractTextFromContent(lastMsg?.content ?? lastMsg?.text);
    if (text) return text.trim().slice(0, maxChars);
  }

  // String prompt / input
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    return body.prompt.trim().slice(0, maxChars);
  }
  if (typeof body.input === "string" && body.input.trim()) {
    return body.input.trim().slice(0, maxChars);
  }

  return "";
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Build choice criteria dictionary for System One from an array of models.
 * Criteria keys are the model names; values are null so System One uses its
 * native knowledge of models without manual descriptions.
 *
 * @param {string[]} models - Array of model IDs in the combo
 * @returns {Record<string, null>} Criteria map
 */
export function buildChoiceCriteria(models) {
  const criteria = {};
  if (!Array.isArray(models)) return criteria;
  for (const m of models) {
    if (typeof m === "string" && m.trim().length > 0) {
      criteria[m.trim()] = null;
    }
  }
  return criteria;
}

/**
 * Parse a System One route response JSON.
 *
 * @param {object} json - Upstream response payload
 * @returns {{ choice: string, confidence: number|null, probabilities: Record<string, number>|null } | null}
 */
export function parseSystemOneRouteAnswer(json) {
  if (!json || typeof json !== "object") return null;

  const route = json.answers?.route;
  if (!route || typeof route !== "object") return null;

  const rawChoice = typeof route.choice === "string" ? route.choice.trim() : "";
  if (!rawChoice) return null;

  const confidence = typeof route.confidence === "number" && Number.isFinite(route.confidence)
    ? route.confidence
    : null;

  let probabilities = null;
  if (route.probabilities && typeof route.probabilities === "object" && !Array.isArray(route.probabilities)) {
    probabilities = {};
    for (const [k, v] of Object.entries(route.probabilities)) {
      const num = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(num)) {
        probabilities[k] = num;
      }
    }
  }

  return {
    choice: rawChoice,
    confidence,
    probabilities,
  };
}

/**
 * Order combo models based on System One choice result:
 * 1. The selected choice is placed at index 0.
 * 2. Remaining models are ordered by probabilities descending.
 * 3. Models without probabilities retain their relative order at the end.
 *
 * @param {string[]} models - Original models array
 * @param {object} choiceResult - Parsed System One choice
 * @returns {string[]} Reordered models array
 */
export function orderModelsByChoice(models, choiceResult) {
  if (!Array.isArray(models) || models.length <= 1) return models || [];
  if (!choiceResult?.choice || !models.includes(choiceResult.choice)) return [...models];

  const { choice, probabilities } = choiceResult;
  const others = models.filter((m) => m !== choice);

  if (probabilities && typeof probabilities === "object") {
    others.sort((a, b) => {
      const pA = probabilities[a] ?? 0;
      const pB = probabilities[b] ?? 0;
      return pB - pA;
    });
  }

  return [choice, ...others];
}
