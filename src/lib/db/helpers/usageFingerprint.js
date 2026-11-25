import { createHash } from "node:crypto";

// Reporting identity only; never use this value to authenticate a request.
export const fingerprint = raw => "usage:" + createHash("sha256").update(raw).digest("hex");

// Pre-fingerprint DBs and legacy JSON may contain the bearer both in a
// daily bucket's name and in its apiKey field. Preserve separate counters
// if the raw and fingerprinted forms already coexist in the same day.
export function usageIdentity(value) {
  if (!value) return null;
  return /^usage:[0-9a-f]{64}$/.test(value) ? value : fingerprint(value);
}

export function redactDailyKeys(day) {
  const buckets = day?.byApiKey;
  if (!buckets) return false;
  let changed = false;
  for (const [name, entry] of Object.entries(buckets)) {
    if (!entry?.apiKey) continue;
    const raw = entry.apiKey, ref = usageIdentity(raw);
    if (raw === ref) continue;
    entry.apiKey = ref;
    if (name === raw || name.startsWith(raw + "|")) {
      delete buckets[name];
      let next = ref + name.slice(raw.length);
      while (Object.hasOwn(buckets, next)) next += "|legacy";
      buckets[next] = entry;
    }
    changed = true;
  }
  return changed;
}
