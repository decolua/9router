/**
 * DiepXuan Custom Usage Fetchers
 * Contains usage logic for providers specific to the DiepXuan fork.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";

/**
 * Alibaba Cloud Model Studio (DashScope) Coding Plan usage
 */
export async function getAlicodeUsage(apiKey, provider, proxyOptions = null) {
  const isIntl = provider === "alicode-intl";
  const region = isIntl ? "International" : "China";
  const consoleUrl = isIntl
    ? "https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=globalset#/efm/coding_plan"
    : "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/coding_plan";

  const isCodingPlanKey = apiKey && apiKey.startsWith("sk-sp-");

  if (!apiKey) {
    return { message: "Alibaba API key not available." };
  }

  if (!isCodingPlanKey) {
    return {
      message: `This appears to be a standard DashScope API key (sk-xxx), not a Coding Plan key (sk-sp-xxx). Coding Plan quota tracking requires a subscription API key.`,
    };
  }

  const baseUrl = isIntl
    ? "https://coding-intl.dashscope.aliyuncs.com"
    : "https://coding.dashscope.aliyuncs.com";

  let detectedPlan = null;
  let rawHeaders = {};

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await proxyAwareFetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    }, proxyOptions);

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { message: "Alibaba API key invalid or expired. Please check your Coding Plan subscription." };
      }
      console.warn(`[Alicode Usage] Models endpoint returned ${response.status}`);
    }

    for (const [key, value] of response.headers.entries()) {
      const lk = key.toLowerCase();
      if (lk.includes("rate") || lk.includes("quota") || lk.includes("limit") || lk.includes("remaining") || lk.includes("plan") || lk.includes("tier")) {
        rawHeaders[key] = value;
      }
    }

    if (Object.keys(rawHeaders).length > 0) {
      console.log(`[Alicode Usage] Rate limit headers:`, rawHeaders);

      for (const [, value] of Object.entries(rawHeaders)) {
        const numMatch = value.match(/(\d+)/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          if (num === 6000) detectedPlan = "pro";
          else if (num === 1200) detectedPlan = "lite";
          else if (num >= 45000) detectedPlan = "pro";
          else if (num === 9000 || num === 18000) detectedPlan = "lite";
        }
      }
    }
  } catch (error) {
    console.warn(`[Alicode Usage] Probe failed: ${error.message}`);
  }

  if (detectedPlan === "lite") {
    return {
      plan: "Coding Plan Lite",
      quotas: {
        "5-hour (sliding)": { used: 0, total: 1200, resetAt: null, note: "Rolling window - resets 5h after each request" },
        "weekly (7d)": { used: 0, total: 9000, resetAt: null, note: "Resets Monday 00:00 UTC+8" },
        "monthly (30d)": { used: 0, total: 18000, resetAt: null, note: "Resets on subscription date monthly (UTC+8)" },
      },
      message: `Alibaba ${region} Coding Plan Lite detected. Check detailed usage at: ${consoleUrl}`,
    };
  }

  if (detectedPlan === "pro") {
    return {
      plan: "Coding Plan Pro",
      quotas: {
        "5-hour (sliding)": { used: 0, total: 6000, resetAt: null, note: "Rolling window - resets 5h after each request" },
        "weekly (7d)": { used: 0, total: 45000, resetAt: null, note: "Resets Monday 00:00 UTC+8" },
        "monthly (30d)": { used: 0, total: 90000, resetAt: null, note: "Resets on subscription date monthly (UTC+8)" },
      },
      message: `Alibaba ${region} Coding Plan Pro detected. Check detailed usage at: ${consoleUrl}`,
    };
  }

  return {
    plan: "Coding Plan",
    message: `Alibaba ${region} Coding Plan connected. Plan auto-detection unavailable (no quota API). Lite: 1,200 req/5h, 9,000 req/week, 18,000 req/month. Pro: 6,000 req/5h, 45,000 req/week, 90,000 req/month. Check plan & usage at: ${consoleUrl}`,
    quotas: [],
  };
}
