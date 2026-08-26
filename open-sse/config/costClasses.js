/**
 * Which provider prefixes cost money to call.
 *
 * The tuner owns the full cost model (`tuner/bench.json` -> `costClass`, keyed by the
 * same prefixes) and uses it to order a combo. The router needs a much smaller
 * version of the same fact at request time: when it reorders a combo for a
 * capability, it must not promote a subscription model over a free one that can do
 * the job just as well.
 *
 * Deliberately a duplicate rather than an import. `open-sse/` is the
 * provider-agnostic engine and does not read the tuner's files; keeping a short
 * prefix list here is the smaller cost. It must track `_subscriptionPrefixes` in
 * bench.json — if a prefix is added there, add it here too.
 */

export const PAID_PROVIDER_PREFIXES = new Set(["ocg", "ag", "cx", "cmc"]);

/** True when a combo entry ("ag/claude-opus-4-6-thinking") is billed or subscription-backed. */
export function isPaidModel(modelStr) {
  if (typeof modelStr !== "string") return false;
  const slash = modelStr.indexOf("/");
  if (slash <= 0) return false;
  return PAID_PROVIDER_PREFIXES.has(modelStr.slice(0, slash));
}
