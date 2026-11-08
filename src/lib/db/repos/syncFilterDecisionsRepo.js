import { makeKv } from "../helpers/kvStore.js";

/**
 * Persistent memory for user's manual provider model filter decisions.
 *
 * When updating provider models with the aihot.news leaderboard filter enabled,
 * models that cannot be classified with 100% confidence are presented to the
 * user for manual decision (keep or reject).
 *
 * These decisions are stored here so the user never has to review the same
 * model twice across future updates.
 *
 * key   = model identifier string (or normalized model ID)
 * value = { decision: "keep" | "reject", updatedAt: string, note?: string }
 */
const decisionsKv = makeKv("syncModelFilterDecisions");

/**
 * @returns {Promise<Object<string, {decision: "keep"|"reject", updatedAt: string}>>}
 */
export async function getFilterDecisions() {
  return await decisionsKv.getAll();
}

/**
 * Get single model's filter decision.
 * @param {string} modelId
 * @returns {Promise<{decision: "keep"|"reject", updatedAt: string}|null>}
 */
export async function getFilterDecision(modelId) {
  if (!modelId) return null;
  return await decisionsKv.get(modelId);
}

/**
 * Record a decision for a single model.
 * @param {string} modelId
 * @param {"keep"|"reject"} decision
 * @param {string} [note]
 */
export async function setFilterDecision(modelId, decision, note = "") {
  if (!modelId || (decision !== "keep" && decision !== "reject")) return;
  await decisionsKv.set(modelId, {
    decision,
    updatedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  });
}

/**
 * Batch record decisions.
 * @param {Object<string, "keep"|"reject"|{decision: "keep"|"reject", note?: string}>} map
 */
export async function setFilterDecisions(map) {
  if (!map || typeof map !== "object") return;
  const payload = {};
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(map)) {
    if (!k) continue;
    if (typeof v === "string" && (v === "keep" || v === "reject")) {
      payload[k] = { decision: v, updatedAt: now };
    } else if (v && typeof v === "object" && (v.decision === "keep" || v.decision === "reject")) {
      payload[k] = { decision: v.decision, updatedAt: now, ...(v.note ? { note: v.note } : {}) };
    }
  }
  await decisionsKv.setMany(payload);
}

/**
 * Forget one model's filter decision so it is reconsidered fresh.
 * @param {string} modelId
 */
export async function deleteFilterDecision(modelId) {
  if (!modelId) return;
  await decisionsKv.remove(modelId);
}

/**
 * Clear all remembered filter decisions.
 */
export async function clearFilterDecisions() {
  await decisionsKv.clear();
}
