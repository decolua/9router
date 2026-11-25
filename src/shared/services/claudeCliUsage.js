/**
 * Quota for the Claude Code CLI provider.
 *
 * claude-cli appears in USAGE_ROUTED_PROVIDERS because its connections carry
 * authType "none" — the credential is local rather than held by this server.
 * That is a statement about auth, not about quota. The account behind it is an
 * ordinary Claude subscription, and the OAuth usage endpoint the `claude`
 * provider already reads answers for it: the same `five_hour` / `seven_day`
 * windows, the same `utilization` and `resets_at`.
 *
 * Reading it here is what gives the card a percentage, a progress bar and a
 * reset countdown like every other provider, instead of bare counters. It also
 * means the figures are the subscription's real remaining capacity rather than
 * this server's own tally.
 *
 * That endpoint is not open to every account. A credential from
 * `claude setup-token` — the only kind that works in a container — is refused
 * with "OAuth token does not meet scope requirement user:profile". Those
 * accounts are not without quota, though: the CLI reports the same two windows
 * on every routed request, and claudeCliRateLimits.js keeps the last ones seen.
 *
 * So there are three sources, in order of authority: the usage endpoint, the
 * windows the CLI last reported, and — for an account that has neither — a
 * count of what this server itself routed.
 */
import { getClaudeUsage } from "open-sse/services/usage/claude.js";
import { rateLimitWindows, windowsToQuotas, cacheUsageSentence } from "open-sse/executors/claudeCliRateLimits.js";
import { claudeCliAccessToken } from "@/shared/services/claudeCliAccountRepair";
import { getRoutedUsage } from "@/shared/services/routedUsage";

/**
 * @param {{ id: string, provider: string, providerSpecificData?: object }} connection
 * @param {object|null} proxyOptions
 * @param {{ force?: boolean }} [options] force bypasses the 5-minute usage cache
 * @returns {Promise<object>} the same payload shape the `claude` provider returns
 */
export async function getClaudeCliUsage(connection, proxyOptions = null, options = {}) {
  const token = await claudeCliAccessToken(connection?.providerSpecificData || {});

  let failure = null;
  if (token) {
    // getClaudeUsage never throws: a 429, a network the server cannot reach,
    // or a credential the endpoint will not accept all come back as
    // { message }. Only a reading with windows in it is worth showing —
    // returning the soft failure would replace real figures with an error
    // string on a card that had been working.
    const usage = await getClaudeUsage(token, proxyOptions, { force: options?.force === true });
    if (usage?.quotas && Object.keys(usage.quotas).length > 0) {
      const cache = cacheUsageSentence(connection?.providerSpecificData || {});
      return cache ? { ...usage, message: `${usage.message || ""}${cache}`.trim() } : usage;
    }
    failure = usage?.message || "the usage endpoint returned nothing";
  }

  // Second source, and the only one an account from `claude setup-token` has:
  // the CLI reports the same two windows on every routed request, because they
  // come back with its own upstream call rather than from an endpoint that
  // checks scopes. Same shape, same card.
  const recorded = rateLimitWindows(connection?.providerSpecificData || {});
  const quotas = windowsToQuotas(recorded?.windows);
  if (quotas) {
    return {
      plan: "Claude Code",
      quotas,
      message: "Reported by Claude Code on this account's last routed request"
        + (recorded.at ? ` (${new Date(recorded.at).toISOString()})` : "")
        + "."
        + cacheUsageSentence(connection?.providerSpecificData || {}),
    };
  }

  // Say which of the two happened. Falling back silently makes "no credential
  // to ask with" and "asked and could not get an answer" look identical on the
  // card, and they need completely different fixes — the first is an account
  // that needs signing in, the second is a token the endpoint will not accept
  // or a network this server cannot reach.
  const routed = await getRoutedUsage(connection);
  return {
    ...routed,
    message: token
      ? `${routed.message} Its subscription quota could not be read: ${failure}`
        + cacheUsageSentence(connection?.providerSpecificData || {})
      : `${routed.message} No credential could be resolved for this account, so its `
        + "subscription quota was never asked for."
        + cacheUsageSentence(connection?.providerSpecificData || {}),
  };
}

export default getClaudeCliUsage;
