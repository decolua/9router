import { getDailyKeyModelCost } from "../db/repos/usageRepo.js";

export function secondsUntilLocalMidnight(now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const diff = midnight.getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / 1000);
}

export async function checkApiKeyDailyCost({ apiKey, model, provider, settings }) {
  const limits = settings?.apiKeyDailyCostLimits || {};
  const limit = limits[model];
  if (typeof limit !== "number" || limit <= 0) {
    return { blocked: false };
  }

  const cost = await getDailyKeyModelCost({ apiKey, model, provider });
  if (cost >= limit) {
    return { blocked: true, retryAfterSeconds: secondsUntilLocalMidnight() };
  }
  return { blocked: false };
}
