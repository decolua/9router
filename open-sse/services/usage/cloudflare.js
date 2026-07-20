import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * Fetch Cloudflare Workers AI quota via GraphQL API.
 * Queries neuronsSum for current day from Cloudflare Analytics API.
 * CF Workers AI free tier: 10,000 neurons/day (resets daily at midnight UTC).
 * Falls back to token-verify + static quota if GraphQL is unavailable.
 */
export async function getCloudflareAIUsage(connection, proxyOptions = null) {
  const { apiKey, providerSpecificData } = connection;
  if (!apiKey) return { message: "Cloudflare AI usage unavailable: no API token" };

  const accountId = providerSpecificData?.accountId;
  const fetchFn = proxyOptions ? proxyAwareFetch : fetch;

  // Calculate today's UTC date range for the GraphQL query
  const now = new Date();
  const todayUTC = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const nextMidnightUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));

  const FREE_TIER_TOTAL = 10000;

  // === Step 1: Try GraphQL to get real usage (requires accountId + Account Analytics:Read permission) ===
  if (accountId) {
    try {
      // Cloudflare Analytics GraphQL — correct filter format uses datetimeDay_geq/datetimeDay_lt
      // Table: workersAiInferencesAdaptiveGroups, field: neuronsUsed
      // Requires "Account Analytics:Read" token permission
      const tomorrowUTC = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
      )).toISOString().slice(0, 10);

      const gqlQuery = {
        query: `{
          viewer {
            accounts(filter: { accountTag: "${accountId}" }) {
              workersAiInferencesAdaptiveGroups(
                filter: {
                  datetimeDay_geq: "${todayUTC}"
                  datetimeDay_lt: "${tomorrowUTC}"
                }
                limit: 100
              ) {
                sum {
                  neuronsUsed
                }
              }
            }
          }
        }`
      };

      const gqlRes = await fetchFn(
        "https://api.cloudflare.com/client/v4/graphql",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(gqlQuery),
        },
        proxyOptions || undefined
      );

      if (gqlRes.ok) {
        const gqlData = await gqlRes.json().catch(() => null);

        // Log GraphQL errors for debugging
        if (gqlData?.errors?.length) {
          console.warn(`[CF-QUOTA] GraphQL errors for ${accountId}:`, JSON.stringify(gqlData.errors[0]));
        }

        const groups = gqlData?.data?.viewer?.accounts?.[0]?.workersAiInferencesAdaptiveGroups;

        if (Array.isArray(groups)) {
          const neuronsUsed = groups.reduce((total, g) => total + (g?.sum?.neuronsUsed || 0), 0);
          const remaining = Math.max(0, FREE_TIER_TOTAL - neuronsUsed);

          return {
            quotas: {
              "Workers AI": {
                total: FREE_TIER_TOTAL,
                used: neuronsUsed,
                remaining,
                unit: "neurons",
                resetAt: nextMidnightUTC.toISOString(),
              },
            },
            plan: "Free Tier",
          };
        }
      } else {
        const errText = await gqlRes.text().catch(() => "");
        console.warn(`[CF-QUOTA] GraphQL HTTP ${gqlRes.status} for ${accountId}: ${errText.slice(0, 200)}`);
      }
    } catch (gqlErr) {
      console.warn(`[CF-QUOTA] GraphQL exception for ${accountId}:`, gqlErr.message);
    }
  }

  // === Step 2: Fallback — local DB tracking (usageDaily.byAccount) ===
  // Token is valid but no GraphQL analytics permission.
  // Use 9router's own request logs for real-time approximation.
  let localNeurons = 0;
  const isExhausted = connection.errorCode === 429 || connection.errorCode === "429";
  try {
    const { getDailyUsageByConnection } = await import("../../../src/lib/db/index.js");
    const daily = await getDailyUsageByConnection(connection.id);
    if (daily) {
      const out = daily.completionTokens || 0;
      const req = daily.requests || 0;
      localNeurons = Math.max(out, req * 100);
    }
    if (isExhausted && localNeurons < FREE_TIER_TOTAL) localNeurons = FREE_TIER_TOTAL;
  } catch (_) {
    if (isExhausted) localNeurons = FREE_TIER_TOTAL;
  }

  // === Step 3: Verify token is active ===
  try {
    const res = await fetchFn(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
      proxyOptions || undefined
    );

    if (!res.ok) {
      return { message: `Token invalid (HTTP ${res.status})` };
    }

    const data = await res.json().catch(() => ({}));
    const tokenStatus = data?.result?.status || "unknown";

    if (tokenStatus !== "active") {
      return { message: `Token status: ${tokenStatus}` };
    }

    const displayUsed = Math.min(localNeurons, FREE_TIER_TOTAL);
    const noteText = localNeurons > 0
      ? "Tracked from local request logs (tokens ≈ neurons). Resets midnight UTC."
      : (accountId ? "Could not fetch real usage from GraphQL API" : "Add accountId for real usage data");

    return {
      quotas: {
        "Workers AI": {
          total: FREE_TIER_TOTAL,
          used: displayUsed,
          remaining: Math.max(0, FREE_TIER_TOTAL - displayUsed),
          unit: "neurons",
          resetAt: nextMidnightUTC.toISOString(),
          note: noteText,
        },
      },
      plan: "Free Tier",
    };
  } catch (err) {
    return { message: `Cloudflare AI usage error: ${err.message}` };
  }
}
