/**
 * ZCode Start Plan usage (zcode.z.ai plan gateway).
 *
 * Mirrors the desktop client's getStartPlanSnapshot:
 *   GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance?app_version=<ver>
 *   Authorization: Bearer <zcode JWT>
 *   X-Device-Mid: <stable device id>   (required; without it the API answers 3001)
 *
 * The envelope carries { data: { plans, balances, server_time } }; each balance
 * bucket is a token entitlement (total/used/remaining/expires_at).
 */

import crypto from "node:crypto";
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const ZCODE_BALANCE_URL = "https://zcode.z.ai/api/v1/zcode-plan/billing/balance";
const ZCODE_APP_VERSION = "3.16.3";

function stableDeviceMid(connection) {
  const seed = String(connection?.providerSpecificData?.userId || connection?.id || "zcode");
  const bytes = crypto.createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parseZcodeStartPlanBalance(json) {
  const data = json?.data && typeof json.data === "object" ? json.data : {};
  const plans = Array.isArray(data.plans) ? data.plans : [];
  const balances = Array.isArray(data.balances) ? data.balances : [];

  const activePlan = plans.find((plan) => {
    if (String(plan?.status || "").toLowerCase() !== "active") return false;
    const identity = `${plan?.plan_id || ""} ${plan?.name || ""}`.toLowerCase();
    return identity.includes("start-plan") || identity.includes("start plan");
  });
  if (!activePlan) return { message: "No active ZCode Start Plan." };

  const quotas = {};
  for (const balance of balances) {
    const total = Number(balance?.total_units);
    const used = Number(balance?.used_units);
    if (!Number.isFinite(total) && !Number.isFinite(used)) continue;

    const models = (Array.isArray(balance?.capabilities) ? balance.capabilities : [])
      .map((capability) => String(capability).trim())
      .filter((capability) => capability.toLowerCase().startsWith("model:"))
      .map((capability) => capability.slice(6).trim());
    const name = balance?.show_name || models.join(", ") || balance?.entitlement_id || balance?.meter || "Quota";
    const expiresAt = Number(balance?.expires_at);
    const resetAt = Number.isFinite(expiresAt) && expiresAt > 0 ? new Date(expiresAt * 1000).toISOString() : null;
    const remainingUnits = Number(balance?.remaining_units);
    const remaining = Number.isFinite(remainingUnits)
      ? remainingUnits
      : Number.isFinite(total) && Number.isFinite(used)
        ? total - used
        : null;

    quotas[name] = {
      used: Number.isFinite(used) ? used : 0,
      total: Number.isFinite(total) ? total : 0,
      // Remaining share with decimals so small usage is not rounded up to 100%.
      ...(Number.isFinite(total) && total > 0 && Number.isFinite(remaining)
        ? { percentage: (remaining / total) * 100, percentageIsUsed: false }
        : {}),
      resetAt,
      expiresAt: resetAt,
      // The start-plan grant is one_time: display the absolute expiry, not a
      // recurring reset countdown.
      recurring: false,
      absoluteReset: true,
    };
  }

  if (!Object.keys(quotas).length) return { message: "ZCode Start Plan has no usage buckets." };
  return { plan: activePlan.name || activePlan.plan_id || "Start Plan", quotas };
}

export function buildZcodeBalanceRequest(connection) {
  const token = String(connection?.providerSpecificData?.zcodeJwtToken || "").trim();
  if (!token) return null;
  const url = new URL(ZCODE_BALANCE_URL);
  url.searchParams.set("app_version", ZCODE_APP_VERSION);
  return {
    url: url.toString(),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": `ZCode/${ZCODE_APP_VERSION}`,
      "HTTP-Referer": "https://zcode.z.ai",
      "X-ZCode-App-Version": ZCODE_APP_VERSION,
      "X-Title": "Z Code@electron",
      "X-Release-Channel": "production",
      "X-Client-Language": "en-US",
      "X-Client-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      "X-ZCode-Agent": "glm",
      "X-Platform": "win32-x64",
      "X-Os-Category": "windows",
      "X-Os-Version": "10.0.26300",
      "X-Device-Mid": stableDeviceMid(connection),
      "X-Request-Id": crypto.randomUUID(),
    },
  };
}

export async function getZcodeUsage(connection, proxyOptions = null) {
  const request = buildZcodeBalanceRequest(connection);
  if (!request) return { message: "ZCode zcode JWT is not available. Reconnect the account." };

  try {
    const response = await proxyAwareFetch(
      request.url,
      { headers: request.headers },
      proxyOptions,
    );

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return { message: `ZCode balance response is invalid (HTTP ${response.status}).` };
    }

    if (!response.ok) {
      if (response.status === 401) return { message: "ZCode session expired. Reconnect the account." };
      return { message: json?.msg || `ZCode balance API error (${response.status}).` };
    }
    if (json?.code !== 0) return { message: json?.msg || `ZCode balance failed (${json?.code}).` };

    return parseZcodeStartPlanBalance(json);
  } catch (error) {
    return { message: `ZCode usage error: ${error.message}` };
  }
}
