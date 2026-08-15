/**
 * Cloudflare Workers AI usage handler.
 *
 * Cloudflare bills Workers AI by "neurons" with a free daily allocation
 * (10,000 neurons/day on the free plan). There is no dedicated quota API;
 * usage is retrieved from the GraphQL analytics endpoint
 * (aiWorkersAiInvocationsAdaptiveGroups) and compared against the free-tier
 * daily ceiling. Paid plans have higher/uncapped allocations — the ceiling
 * here is the documented free-tier value, surfaced as a best-effort limit.
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
    query WorkersAiUsage($accountTag: String!, $since: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiWorkersAiInvocationsAdaptiveGroups(
            filter: { date_geq: $since }
            limit: 100
          ) {
            sum {
              neurons
              requests
            }
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
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { message: `Cloudflare analytics error: ${response.status} ${errorText.slice(0, 120)}` };
    }

    const data = await response.json();
    const groups = data?.data?.viewer?.accounts?.[0]?.aiWorkersAiInvocationsAdaptiveGroups || [];
    const sum = groups.reduce(
      (acc, g) => ({
        neurons: acc.neurons + toFiniteNumber(g?.sum?.neurons),
        requests: acc.requests + toFiniteNumber(g?.sum?.requests),
      }),
      { neurons: 0, requests: 0 }
    );

    const used = sum.neurons;
    const total = FREE_TIER_DAILY_NEURONS;
    const resetAt = nextUtcMidnight();

    return {
      plan: "Workers AI Free (10k neurons/day)",
      resetDate: resetAt,
      quotas: {
        neurons: {
          used,
          total,
          unlimited: false,
          remainingPercentage: total > 0 ? Math.max(0, Math.round(((total - used) / total) * 100)) : 0,
          resetAt,
        },
        requests: {
          used: sum.requests,
          total: 0,
          unlimited: true,
          resetAt,
        },
      },
    };
  } catch (error) {
    return { message: `Failed to fetch Cloudflare usage: ${error.message}` };
  }
}