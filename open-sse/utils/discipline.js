const STRIKE_TTL_MS = 10 * 60 * 1000;
const LOCK_THRESHOLD = 3;

export const strikeStore = new Map();

function getActiveEntry(model, now) {
  const entry = strikeStore.get(model);
  if (!entry || now - entry.lastTs > STRIKE_TTL_MS) {
    strikeStore.delete(model);
    return null;
  }
  return entry;
}

export function recordStrike(model, kind, now = Date.now()) {
  if (!model) return { count: 0, shouldLock: false };

  const entry = getActiveEntry(model, now) || {
    kinds: new Set(),
    count: 0,
    malformedCount: 0,
    lastTs: now,
    nudgePending: false,
  };
  entry.kinds.add(kind);
  entry.count += 1;
  if (kind === "doubled-json") entry.malformedCount += 1;
  entry.lastTs = now;
  entry.nudgePending = true;
  strikeStore.set(model, entry);

  const count = entry.malformedCount;
  const shouldLock = count >= LOCK_THRESHOLD;
  if (shouldLock) entry.malformedCount = 0;
  return { count, shouldLock };
}

export function consumeNudge(model, now = Date.now()) {
  const entry = getActiveEntry(model, now);
  if (!entry?.nudgePending) return false;
  entry.nudgePending = false;
  return true;
}

export function clearDisciplineStrikes() {
  strikeStore.clear();
}
