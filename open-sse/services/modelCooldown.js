// Per-model cooldown memory for the combo cascade. A model that just returned a
// retry-after or a cooldown is known-unavailable until that window elapses;
// trying it again on the next request burns a round trip to learn what we were
// already told. Module-level Map: single process, synchronous access, no locking
// needed. Bounded by model cardinality, and expired entries are dropped on read.

const cooldowns = new Map();

export function markModelCooldown(model, untilMs) {
  if (!model || !untilMs) return;
  const prev = cooldowns.get(model) || 0;
  if (untilMs > prev) cooldowns.set(model, untilMs);
}

export function markModelCooldownFrom(model, retryAfter, cooldownMs, now = Date.now()) {
  if (!model) return;
  let until = 0;
  if (retryAfter) {
    const t = new Date(retryAfter).getTime();
    if (!Number.isNaN(t)) until = t;
  }
  if (cooldownMs && now + cooldownMs > until) until = now + cooldownMs;
  if (until > now) markModelCooldown(model, until);
}

export function isModelCoolingDown(model, now = Date.now()) {
  const until = cooldowns.get(model);
  if (!until) return false;
  if (until <= now) {
    cooldowns.delete(model);
    return false;
  }
  return true;
}

export function modelCooldownRemaining(model, now = Date.now()) {
  const until = cooldowns.get(model);
  return until && until > now ? until - now : 0;
}

export function clearModelCooldowns() {
  cooldowns.clear();
}
