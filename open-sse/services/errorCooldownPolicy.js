export const MAX_ERROR_COOLDOWN_RULES = 20;
const MIN_CUSTOM_MS = 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function validateTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) throw new Error("Timezone is required");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
  catch { throw new Error("Timezone is invalid"); }
  return timeZone.trim();
}

function normalizeDuration(duration) {
  if (!duration || typeof duration !== "object" || Array.isArray(duration)) {
    throw new Error("Cooldown duration is required");
  }
  if (["end-of-day", "half-hour", "one-hour", "five-hours", "one-day"].includes(duration.mode)) {
    return { mode: duration.mode };
  }
  if (duration.mode !== "custom") throw new Error("Invalid cooldown duration mode");
  if (!["minutes", "hours", "days"].includes(duration.unit)) throw new Error("Invalid custom duration unit");
  const value = Number(duration.value);
  const multiplier = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[duration.unit];
  const durationMs = value * multiplier;
  if (!Number.isInteger(value) || durationMs < MIN_CUSTOM_MS || durationMs > MAX_COOLDOWN_MS) {
    throw new Error("Custom cooldown must be between 1 minute and 30 days");
  }
  return { mode: "custom", value, unit: duration.unit };
}

function normalizeRule(rule, index) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error(`Rule ${index + 1} is invalid`);
  if (rule.statuses !== undefined && !Array.isArray(rule.statuses)) throw new Error(`Rule ${index + 1} statuses must be an array`);
  if (rule.codes !== undefined && !Array.isArray(rule.codes)) throw new Error(`Rule ${index + 1} codes must be an array`);
  if (rule.message !== undefined && typeof rule.message !== "string") throw new Error(`Rule ${index + 1} message must be text`);
  if (rule.name !== undefined && typeof rule.name !== "string") throw new Error(`Rule ${index + 1} name must be text`);
  const statuses = Array.isArray(rule.statuses) ? [...new Set(rule.statuses.map(Number))] : [];
  if (statuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    throw new Error(`Rule ${index + 1} has an invalid HTTP status`);
  }
  if ((rule.codes || []).some((code) => typeof code !== "string" && typeof code !== "number")) {
    throw new Error(`Rule ${index + 1} has an invalid error code`);
  }
  const codes = Array.isArray(rule.codes)
    ? [...new Set(rule.codes.map((code) => String(code).trim().toLowerCase()).filter(Boolean))]
    : [];
  if (codes.some((code) => code.length > 64)) throw new Error(`Rule ${index + 1} has an error code longer than 64 characters`);
  const message = typeof rule.message === "string" ? rule.message.trim() : "";
  if (message.length > 200) throw new Error(`Rule ${index + 1} has a message longer than 200 characters`);
  if (statuses.length === 0 && codes.length === 0 && !message) return null;
  const name = typeof rule.name === "string" ? rule.name.trim() : "";
  if (name.length > 80) throw new Error(`Rule ${index + 1} has a name longer than 80 characters`);
  if (rule.scope !== "key" && rule.scope !== "model") throw new Error(`Rule ${index + 1} has an invalid scope`);
  return { name, statuses, codes, message, scope: rule.scope, duration: normalizeDuration(rule.duration) };
}

export function normalizeErrorCooldownPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("Error cooldown policy is invalid");
  if (typeof policy.enabled !== "boolean") throw new Error("Error cooldown policy enabled must be boolean");
  if (policy.enabled !== true && policy.timezone === undefined && policy.defaultDuration === undefined && policy.rules === undefined) {
    return { enabled: false };
  }
  if (!Array.isArray(policy.rules)) throw new Error("Cooldown rules must be an array");
  if (policy.rules.length > MAX_ERROR_COOLDOWN_RULES) {
    throw new Error(`A connection can have at most ${MAX_ERROR_COOLDOWN_RULES} cooldown rules`);
  }
  return {
    enabled: policy.enabled === true,
    timezone: validateTimeZone(policy.timezone),
    defaultDuration: normalizeDuration(policy.defaultDuration),
    rules: policy.rules.map(normalizeRule).filter(Boolean),
  };
}

function localDateKey(formatter, timestamp) {
  const parts = formatter.formatToParts(new Date(timestamp));
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function millisecondsUntilNextDay(timeZone, now) {
  const formatter = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const today = localDateKey(formatter, now);
  let low = now;
  let high = now + 36 * 60 * 60 * 1000;
  while (localDateKey(formatter, high) === today) high += 12 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDateKey(formatter, middle) === today) low = middle;
    else high = middle;
  }
  return high - now;
}

function durationToMilliseconds(duration, timeZone, now) {
  if (duration.mode === "end-of-day") return millisecondsUntilNextDay(timeZone, now);
  if (duration.mode === "half-hour") return 30 * 60 * 1000;
  if (duration.mode === "one-hour") return 60 * 60 * 1000;
  if (duration.mode === "five-hours") return 5 * 60 * 60 * 1000;
  if (duration.mode === "one-day") return 24 * 60 * 60 * 1000;
  return duration.value * { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[duration.unit];
}

function ruleMatches(rule, { status, code, message, model }) {
  if (rule.scope === "model" && !model) return false;
  if (rule.statuses.length > 0 && !rule.statuses.includes(Number(status))) return false;
  if (rule.codes.length > 0 && !rule.codes.includes(String(code ?? "").trim().toLowerCase())) return false;
  if (rule.message && !String(message ?? "").toLowerCase().includes(rule.message.toLowerCase())) return false;
  return true;
}

export function resolveErrorCooldown(policy, error, now = Date.now()) {
  if (!policy?.enabled) return null;
  for (let index = 0; index < policy.rules.length; index += 1) {
    const rule = policy.rules[index];
    if (!ruleMatches(rule, error)) continue;
    return {
      cooldownMs: durationToMilliseconds(rule.duration, policy.timezone, now),
      scope: rule.scope,
      source: "rule",
      rule: rule.name || `Rule ${index + 1}`,
    };
  }
  return {
    cooldownMs: durationToMilliseconds(policy.defaultDuration, policy.timezone, now),
    scope: "key",
    source: "default",
    rule: null,
  };
}
