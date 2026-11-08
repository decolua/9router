/**
 * Cloudflare Workers AI usage handler.
 *
 * Cloudflare bills Workers AI by "neurons" with a free daily allocation
 * (10,000 neurons/day on both Free and Paid plans). There is no dedicated quota API;
 * usage is retrieved from the GraphQL analytics endpoint
 * (aiInferenceAdaptiveGroups) and compared against the free-tier
 * daily ceiling. The 10k figure is a daily free-allocation reference, not a paid-plan
 * spending cap. Analytics can be delayed or sampled.
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const FREE_TIER_DAILY_NEURONS = 10_000;

// Next UTC midnight — free allocation resets at 00:00 UTC.
function nextUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return new Date(next).toISOString();
}

// ISO date for `since` (start of today UTC).
function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
}

export async function getCloudflareUsage(apiKey, providerSpecificData, proxyOptions = null) {
  const accountId = providerSpecificData?.accountId;
  if (!accountId) {
    return { message: "Missing Cloudflare Account ID" };
  }
  if (!apiKey) {
    return { message: "No Cloudflare API token available" };
  }

  const since = startOfTodayUtc();
  const query = `
    query WorkersAiUsage($accountTag: string!, $since: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(
            filter: { datetime_geq: $since }
            limit: 1
          ) {
            count
            sum { totalNeurons }
          }
        }
      }
    }`;

  try {
    const response = await proxyAwareFetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { accountTag: accountId, since } }),
      signal: AbortSignal.timeout(15000),
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { message: `Cloudflare analytics error: ${response.status} ${errorText.slice(0, 120)}` };
    }

    const data = await response.json();
    if (data.errors?.length) return { message: `Cloudflare analytics unavailable: ${data.errors.map(error => error.message).join("; ").slice(0, 180)}` };
    const groups = data?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
    if (!Array.isArray(groups) || groups.some(group => group?.sum?.totalNeurons == null || group.count == null || !Number.isFinite(Number(group.sum.totalNeurons)) || !Number.isFinite(Number(group.count)))) {
      return { message: "Cloudflare analytics data unavailable" };
    }
    const sum = groups.reduce(
      (acc, g) => ({
        neurons: acc.neurons + toFiniteNumber(g?.sum?.totalNeurons),
        requests: acc.requests + toFiniteNumber(g?.count),
      }),
      { neurons: 0, requests: 0 }
    );

    const used = sum.neurons;
    const total = FREE_TIER_DAILY_NEURONS;
    const resetAt = nextUtcMidnight();

    return {
      plan: "Workers AI · daily free allocation",
      requests: sum.requests,
      resetDate: resetAt,
      quotas: {
        neurons: {
          name: "Daily free allocation",
          used,
          total,
          unit: "neurons",
          unlimited: false,
          remainingPercentage: total > 0 ? Math.max(0, Math.round(((total - used) / total) * 100)) : 0,
          resetAt,
        },

      },
    };
  } catch (error) {
    return { message: `Failed to fetch Cloudflare usage: ${error.message}` };
  }
}