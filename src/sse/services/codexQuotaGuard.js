import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { CODEX_QUOTA_GUARD_CONFIG } from "@/shared/constants/config";

const state = (global.__codexQuotaGuard ??= {
  healthyUntil: new Map(),
  inFlight: new Map(),
});

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isExhausted(quota) {
  if (!quota || quota.unlimited === true) return false;
  const remaining = finiteNumber(quota.remaining);
  if (remaining !== null) return remaining <= 0;
  const used = finiteNumber(quota.used);
  const total = finiteNumber(quota.total);
  return used !== null && total !== null && total > 0 && used >= total;
}

function getBlockingQuotaResult(usage) {
  const blocking = ["session", "weekly"]
    .map((name) => ({ name, quota: usage?.quotas?.[name] }))
    .filter(({ quota }) => isExhausted(quota));

  if (!usage?.limitReached && blocking.length === 0) return null;

  // If multiple windows are exhausted, the account is usable only after all
  // blocking windows reset, so use the latest known reset.
  const resetTimes = blocking
    .map(({ quota }) => new Date(quota.resetAt).getTime())
    .filter((value) => Number.isFinite(value) && value > Date.now());
  const resetsAtMs = resetTimes.length > 0 ? Math.max(...resetTimes) : null;
  const names = blocking.map(({ name }) => name).join(", ") || "Codex";

  return {
    available: false,
    status: 429,
    error: `${names} quota exhausted`,
    resetsAtMs,
  };
}

async function fetchStatus(credentials) {
  const proxyOptions = {
    connectionProxyEnabled: credentials.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials.providerSpecificData?.vercelRelayUrl || "",
    strictProxy: false,
  };
  const usage = await getCodexUsage(credentials.accessToken, proxyOptions);

  if (usage?.unavailable === true && usage.status === 401) {
    return {
      available: false,
      status: 401,
      error: usage.message || "Codex Usage API unauthorized (401)",
      resetsAtMs: null,
    };
  }

  return getBlockingQuotaResult(usage) || { available: true };
}

/**
 * Verify that a Codex account is authorized and has usable quota before chat.
 * Concurrent checks for the same connection share one Usage API request.
 * Network/5xx usage failures are fail-open; an explicit 401 is fail-closed.
 */
export async function checkCodexQuotaBeforeChat(credentials, options = {}) {
  const key = credentials.connectionId;
  if (!key) return { available: true };

  if (!options.force && (state.healthyUntil.get(key) || 0) > Date.now()) {
    return { available: true, cached: true };
  }
  if (state.inFlight.has(key)) return state.inFlight.get(key);

  const check = fetchStatus(credentials)
    .then((result) => {
      if (result.available) {
        state.healthyUntil.set(key, Date.now() + CODEX_QUOTA_GUARD_CONFIG.healthyCacheMs);
      } else {
        state.healthyUntil.delete(key);
      }
      return result;
    })
    .catch((error) => ({ available: true, checkFailed: true, error: error.message }))
    .finally(() => state.inFlight.delete(key));

  state.inFlight.set(key, check);
  return check;
}

export function clearCodexQuotaGuardCache() {
  state.healthyUntil.clear();
  state.inFlight.clear();
}
