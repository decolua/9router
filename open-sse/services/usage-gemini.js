/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { CLIENT_METADATA, parseResetTime } from "./usage-utils.js";

function normalizeCloudCodeProjectId(project) {
  if (typeof project === "string") return project.trim() || null;
  if (
    project &&
    typeof project === "object" &&
    typeof project.id === "string"
  ) {
    return project.id.trim() || null;
  }
  return null;
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await proxyAwareFetch(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: CLIENT_METADATA,
        }),
        signal: controller.signal,
      },
      proxyOptions,
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getGeminiUsage(
  accessToken,
  providerSpecificData,
  proxyOptions = null,
) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(
      providerSpecificData?.projectId,
    );
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(
        accessToken,
        proxyOptions,
      );
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message:
          "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await proxyAwareFetch(
        "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ project: projectId }),
          signal: controller.signal,
        },
        proxyOptions,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Gemini CLI error: ${error.message}` };
  }
}
