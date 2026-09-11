import REGISTRY from "../../providers/registry/index.js";
import { U, fetchWithTimeout } from "./shared.js";

const freebuffRegistry = REGISTRY.find((entry) => entry.id === "freebuff") || {};
const MODEL_LABELS = Object.fromEntries((freebuffRegistry.models || []).map((model) => [model.id, model.name]));

export async function getFreebuffUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) return { message: "Freebuff credential not available — connect a Freebuff login first." };
  try {
    const response = await fetchWithTimeout(U("freebuff").url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "codebuff-cli/0.0.138", Accept: "application/json" },
    }, 15000, proxyOptions);
    if (response.status === 401) return { message: "Freebuff credential invalid or expired — re-login in the dashboard." };
    if (response.status === 403) {
      const body = await response.json().catch(() => ({}));
      if (body?.status === "country_blocked") return { message: "Freebuff is not available in your region." };
      if (body?.status === "banned") return { message: "Your Freebuff account has been banned." };
      return { message: `Freebuff quota access denied (403)${body?.message ? `: ${body.message}` : ""}.` };
    }
    if (response.status === 404) return { plan: "Freebuff", message: "Freebuff connected. No session quota to report right now." };
    if (!response.ok) return { message: `Freebuff quota API error (${response.status}).` };
    const data = await response.json().catch(() => ({}));
    const rateLimits = { ...(data.rateLimitsByModel || {}) };
    if (data.status === "active" && data.rateLimit && !rateLimits[data.model]) rateLimits[data.model] = data.rateLimit;
    const quotas = {};
    for (const [model, rateLimit] of Object.entries(rateLimits)) {
      if (!rateLimit || typeof rateLimit !== "object") continue;
      const used = Number(rateLimit.recentCount);
      const total = Number(rateLimit.limit);
      quotas[model] = {
        used: Number.isFinite(used) ? used : 0,
        total: Number.isFinite(total) ? total : 0,
        resetAt: rateLimit.resetAt || null,
        unlimited: false,
        recurring: true,
        ...(MODEL_LABELS[model] ? { displayName: MODEL_LABELS[model] } : {}),
      };
    }
    const plan = data.accessTier === "limited" ? "Freebuff (Limited)" : "Freebuff";
    return Object.keys(quotas).length === 0 ? { plan, message: "Freebuff connected. No session quota to report right now." } : { plan, quotas };
  } catch (error) {
    return { message: `Freebuff usage error: ${error.message}` };
  }
}

export default getFreebuffUsage;
