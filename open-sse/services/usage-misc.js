/**
 * Misc provider usage — Qwen, iFlow, Ollama, GLM
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { GLM_QUOTA_URLS } from "./usage-utils.js";

/**
 * Qwen Usage
 */
export async function getQwenUsage(accessToken, providerSpecificData) {
  try {
    const resourceUrl = providerSpecificData?.resourceUrl;
    if (!resourceUrl) {
      return { message: "Qwen connected. No resource URL available." };
    }

    // Qwen may have usage endpoint at resource URL
    return { message: "Qwen connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch Qwen usage." };
  }
}

/**
 * iFlow Usage
 */
export async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

/**
 * Ollama Cloud Usage
 * Ollama Cloud uses an API key from ollama.com/settings/keys
 * and has no public usage API — free tier has light usage limits (resets every 5h & 7d).
 * This returns an informational message with the plan details.
 */
export async function getOllamaUsage(accessToken, providerSpecificData) {
  try {
    // Ollama Cloud does not expose a public quota/usage API.
    // The provider is configured as noAuth with a notice explaining limits.
    // We return a graceful message so the UI shows a friendly state instead of an error.
    const plan = providerSpecificData?.plan || "Free";
    return {
      plan,
      message:
        "Ollama Cloud uses a free tier with light usage limits (resets every 5h & 7d). For detailed usage tracking, visit ollama.com/settings/keys.",
      quotas: [],
    };
  } catch (error) {
    return { message: "Unable to fetch Ollama Cloud usage." };
  }
}

/**
 * GLM Coding Plan usage (international + China regions)
 */
export async function getGlmUsage(apiKey, provider, proxyOptions = null) {
  if (!apiKey) {
    return { message: "GLM API key not available." };
  }

  const region = provider === "glm-cn" ? "china" : "international";
  const quotaUrl = GLM_QUOTA_URLS[region];

  try {
    const response = await proxyAwareFetch(
      quotaUrl,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (!response.ok) {
      if (response.status === 401) {
        return { message: "GLM API key invalid or expired." };
      }
      return { message: `GLM quota API error (${response.status}).` };
    }

    const json = await response.json();
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    const limits = Array.isArray(data.limits) ? data.limits : [];
    const quotas = {};

    for (const limit of limits) {
      if (!limit || limit.type !== "TOKENS_LIMIT") continue;
      const usedPercent = Number(limit.percentage) || 0;
      const resetMs = Number(limit.nextResetTime) || 0;
      const remaining = Math.max(0, 100 - usedPercent);

      quotas["session"] = {
        used: usedPercent,
        total: 100,
        remaining,
        remainingPercentage: remaining,
        resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
        unlimited: false,
      };
    }

    const levelRaw = typeof data.level === "string" ? data.level : "";
    const plan = levelRaw
      ? levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase()
      : "Unknown";

    return { plan, quotas };
  } catch (error) {
    return { message: `GLM error: ${error.message}` };
  }
}
