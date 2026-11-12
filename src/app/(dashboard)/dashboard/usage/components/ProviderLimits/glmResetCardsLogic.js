const PENDING_RESET_ATTEMPT_PREFIX = "9router:resetCardPending:";

// recordIds are unique only within each GLM type bucket.
export function normalizeResetCard(card) {
  if (!card || !["FIVE_HOUR", "WEEK"].includes(card.type)) return null;
  if (!Number.isSafeInteger(card.recordId) && !(typeof card.recordId === "string" && card.recordId.trim())) return null;
  return { id: `${card.type}:${String(card.recordId)}`, provider: "glm", recordId: card.recordId, type: card.type, expiresAt: card.expiresAt ?? null };
}

export function getResetCardTypeLabel(type) {
  return { FIVE_HOUR: "5-hour window", WEEK: "Weekly" }[type] || "Reset";
}

export function isResetCardExpired(expiresAt, now = Date.now()) {
  const time = Date.parse(expiresAt);
  return !Number.isFinite(time) || time <= now;
}

// Every failed or malformed POST remains uncertain, including local API refusals.
export function classifyResetPostOutcome({ ok, payload }) {
  return { kind: ok && payload?.reset === true && payload?.alreadyUsed !== true && payload?.uncertain !== true ? "success" : "uncertain", message: payload?.message || payload?.error || null };
}

export function readPendingResetAttempt(storage, connectionId) {
  if (!storage || !connectionId) return { status: "none" };
  try {
    const raw = storage.getItem(PENDING_RESET_ATTEMPT_PREFIX + connectionId);
    if (raw == null) return { status: "none" };
    const attempt = JSON.parse(raw);
    const card = attempt?.provider === "glm" ? normalizeResetCard(attempt.card) : null;
    if (!card) return { status: "invalid" };
    return { status: "ok", attempt: { provider: "glm", card, startedAt: attempt.startedAt || null } };
  } catch {
    return { status: "invalid" };
  }
}

// The irreversible POST must not run unless this write succeeds.
export function savePendingResetAttempt(storage, connectionId, attempt) {
  if (!storage || !connectionId || !attempt) return false;
  try {
    storage.setItem(PENDING_RESET_ATTEMPT_PREFIX + connectionId, JSON.stringify({ provider: "glm", card: attempt.card, startedAt: attempt.startedAt }));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingResetAttempt(storage, connectionId) {
  if (!storage || !connectionId) return false;
  try {
    storage.removeItem(PENDING_RESET_ATTEMPT_PREFIX + connectionId);
    return true;
  } catch {
    return false;
  }
}
