/**
 * Subscription windows, as the CLI itself reports them.
 *
 * The OAuth usage endpoint is not available to every account. A credential from
 * `claude setup-token` — the only kind that works in a container, where there is
 * no terminal to sign in with — is refused by it:
 *
 *   403 OAuth token does not meet scope requirement user:profile
 *
 * So those accounts had no quota to show at all. But the CLI emits the same
 * numbers on every routed request, in a `rate_limit_event`:
 *
 *   rate_limit_info.unifiedWindows = {
 *     five_hour: { utilization: 0.28, resetsAt: 1790157000 },
 *     seven_day: { utilization: 0.49, resetsAt: 1790319600 },
 *   }
 *
 * — a fraction rather than a percentage, and unix seconds rather than an ISO
 * string, but the same two windows the card draws. Recording them as they go
 * past costs nothing and works for every account, whatever its credential.
 *
 * Held in memory, per server process: the figures belong to a subscription and
 * are stale the moment anything else uses it, so re-reading them from the next
 * request is the point. An account that has routed nothing since the server
 * started has none, and falls back to what this server counted.
 */
import crypto from "node:crypto";
import { CLAUDE_CLI_QUOTA_RETRY_MS } from "../config/claudeCli.js";

// Survives Next's module re-evaluation the way the rest of the codebase does.
const store = (globalThis.__claudeCliRateLimits ??= new Map());

/**
 * A stable key for an account that never contains the credential itself.
 * A config directory is already a path; a token is reduced to a digest, so
 * nothing here is worth stealing.
 */
export function rateLimitAccountKey(psd = {}) {
  // Token first, because that is the order the spawn resolves them in: a
  // CLAUDE_CODE_OAUTH_TOKEN overrides whatever the config directory has stored,
  // so it names the subscription the request actually ran against. Keying on
  // the directory instead filed an account's usage under an identity it was
  // not using.
  if (psd?.oauthToken) {
    return `tok:${crypto.createHash("sha256").update(String(psd.oauthToken)).digest("hex").slice(0, 16)}`;
  }
  if (psd?.configDir) return `dir:${psd.configDir}`;
  return "";
}

/** Record what a routed request was told about the subscription's windows. */
export function recordRateLimitEvent(psd, rateLimitInfo) {
  const key = rateLimitAccountKey(psd);
  const windows = rateLimitInfo?.unifiedWindows;
  if (!key || !windows || typeof windows !== "object") return;
  store.set(key, { windows, at: Date.now() });
}

/** The last windows seen for this account, or null. */
export function rateLimitWindows(psd) {
  const key = rateLimitAccountKey(psd);
  if (!key) return null;
  return store.get(key) || null;
}

/** Only for tests: forget everything recorded so far. */
export function resetRateLimitWindows() {
  store.clear();
  blocks.clear();
  cacheStore.clear();
}

// How much of each account's prompt the cache served, over what it routed.
//
// A prompt cache fails silently: a CLI update that moves the breakpoint, or a
// client that starts stamping the time into its system prompt, takes the hit
// rate to zero with no error anywhere. Kept beside the windows because it is
// read in the same place — the account's quota card — which is where an
// operator already looks when a subscription drains faster than it should.
const cacheStore = (globalThis.__claudeCliCacheUsage ??= new Map());

/** Add one routed turn's usage (the CLI's own `usage` object) to its account. */
export function recordCacheUsage(psd, usage) {
  if (!usage || typeof usage !== "object") return;
  const key = rateLimitAccountKey(psd) || "host";
  const read = Number(usage.cache_read_input_tokens) || 0;
  const prompt = read + (Number(usage.cache_creation_input_tokens) || 0) + (Number(usage.input_tokens) || 0);
  if (!prompt) return;
  const total = cacheStore.get(key) || { read: 0, prompt: 0, turns: 0, since: Date.now() };
  total.read += read;
  total.prompt += prompt;
  total.turns += 1;
  cacheStore.set(key, total);
}

/** `{ read, prompt, turns, since, ratio }` for the account, or null before its first routed turn. */
export function cacheUsageTotals(psd) {
  const total = cacheStore.get(rateLimitAccountKey(psd) || "host");
  if (!total || !total.prompt) return null;
  return { ...total, ratio: total.read / total.prompt };
}

/** One sentence for the quota card, or "" when there is nothing yet. */
export function cacheUsageSentence(psd) {
  const total = cacheUsageTotals(psd);
  if (!total) return "";
  return ` Prompt cache: ${Math.round(total.ratio * 100)}% of ${total.prompt.toLocaleString("en-US")} prompt tokens `
    + `read back from cache over ${total.turns} routed turn${total.turns === 1 ? "" : "s"} since ${new Date(total.since).toISOString()}.`;
}

const WINDOW_NAMES = {
  five_hour: "session (5h)",
  seven_day: "weekly (7d)",
};

function toQuota(window) {
  const utilization = Number(window?.utilization);
  if (!Number.isFinite(utilization)) return null;
  // Reported as a fraction of the window, unlike the usage endpoint's percent.
  const used = Math.max(0, Math.min(100, Math.round(utilization * 100)));
  const resetsAt = Number(window?.resetsAt);
  return {
    used,
    total: 100,
    remaining: 100 - used,
    remainingPercentage: 100 - used,
    // Unix seconds from the CLI; the card wants something Date can parse.
    resetAt: Number.isFinite(resetsAt) && resetsAt > 0
      ? new Date(resetsAt * 1000).toISOString()
      : null,
    unlimited: false,
  };
}

/**
 * The recorded windows in the shape the dashboard renders, under the same names
 * the `claude` provider uses — so one card draws both without knowing which
 * source it got.
 *
 * @returns {object|null} null when nothing usable was recorded
 */
export function windowsToQuotas(windows) {
  if (!windows || typeof windows !== "object") return null;
  const quotas = {};
  for (const [key, name] of Object.entries(WINDOW_NAMES)) {
    const quota = toQuota(windows[key]);
    if (quota) quotas[name] = quota;
  }
  return Object.keys(quotas).length ? quotas : null;
}

// ─── Out of quota ────────────────────────────────────────────────────────────
//
// The CLI says so in two ways, both read from its own schema (2.1.295): a
// `rate_limit_event` whose `rate_limit_info.status` is "rejected" (with
// `resetsAt`, unix seconds, and the `rateLimitType` of the window), and a line
// it composes itself — "You've hit your …", "You're out of usage credits", "Your
// org is out of usage" — as a synthetic assistant message and in an error result.
// Neither is an HTTP status, so a request that hit it used to be delivered as an
// ordinary answer and a combo never moved on.

const blocks = (globalThis.__claudeCliQuotaBlocks ??= new Map());

// Anchored to the start and kept short: the CLI composes these lines whole, and an
// error result can instead carry the model's own answer — max_tokens and the token
// ceiling come back is_error:true with that text — which may say "you've reached
// your goal" without being a limit.
const LIMIT_LINE = /^s*(?:you['’]ve (?:hit|reached) your|you['’]re out of (?:extra )?usage|your org is out of usage|your seat type doesn['’]t include)/i;
const LIMIT_LINE_MAX_CHARS = 300;
const isLimitLine = (text) => typeof text === "string" && text.length <= LIMIT_LINE_MAX_CHARS && LIMIT_LINE.test(text);

const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
  .map((block) => (block?.type === "text" ? block.text : "")).join(" ");

const msFromSeconds = (value) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
};

/**
 * Whether one stream-json event says the account is out of quota.
 * @returns {{ resetsAtMs: number | null } | null} the reset, when the CLI gave one
 */
export function quotaExhaustion(event) {
  if (!event || typeof event !== "object") return null;
  if (event.type === "rate_limit_event") {
    const info = event.rate_limit_info;
    if (info?.status !== "rejected") return null;
    // While paid extra usage covers the overflow nothing is cut off, whatever the
    // subscription window says (schema: overageStatus allowed / allowed_warning).
    if (info.isUsingOverage === true || info.overageStatus === "allowed" || info.overageStatus === "allowed_warning") return null;
    const window = info.rateLimitType ? info.unifiedWindows?.[info.rateLimitType] : null;
    const exhaustion = { resetsAtMs: msFromSeconds(info.resetsAt) ?? msFromSeconds(window?.resetsAt) };
    // A window that belongs to one model family (seven_day_opus, seven_day_sonnet)
    // takes only that family out; the rest of the account still works.
    const scope = /^seven_day_(opus|sonnet)$/.exec(String(info.rateLimitType || ""))?.[1];
    if (scope) exhaustion.scope = scope;
    return exhaustion;
  }
  // Only the CLI's own message: a model describing limits in its own words is
  // not the CLI reporting one.
  if (event.type === "assistant" && event.message?.model === "<synthetic>") {
    return isLimitLine(textOf(event.message).trim()) ? { resetsAtMs: null } : null;
  }
  if (event.type === "result" && event.is_error === true) {
    const lines = [event.result, ...(Array.isArray(event.errors) ? event.errors : [])];
    return lines.some((line) => isLimitLine(line)) ? { resetsAtMs: null } : null;
  }
  return null;
}

// Keyed like the windows; the host's own login has no key, and is one account.
const blockKey = (psd) => rateLimitAccountKey(psd) || "host";

/**
 * Do not ask this account again until its reset (or the retry interval, if
 * unknown). Never shortens a block. `scope` ("opus" / "sonnet") limits it to the
 * models of that family; without one it covers the whole account.
 */
export function markQuotaExhausted(psd, untilMs = null, scope = null) {
  const until = Number.isFinite(untilMs) && untilMs > Date.now() ? untilMs : Date.now() + CLAUDE_CLI_QUOTA_RETRY_MS;
  const key = scope ? `${blockKey(psd)}#${scope}` : blockKey(psd);
  blocks.set(key, Math.max(blocks.get(key) || 0, until));
  return blocks.get(key);
}

/** When the account (for this model) may be asked again, or 0 when it may be asked now. */
export function quotaBlockedUntil(psd, model = null) {
  const base = blockKey(psd);
  let until = 0;
  for (const [key, value] of blocks) {
    if (value <= Date.now()) { blocks.delete(key); continue; }
    if (key === base) until = Math.max(until, value);
    else if (key.startsWith(`${base}#`) && model && String(model).includes(key.slice(base.length + 1))) until = Math.max(until, value);
  }
  return until;
}
