import { getProviderConnections, updateProviderConnection } from "@/lib/db/index.js";

export const KIRO_SUSPENSION_RETRY_MS = 24 * 60 * 60 * 1000;
export const KIRO_SUSPENSION_REASON = "TEMPORARILY_SUSPENDED";

export function isTemporaryKiroSuspension(provider, status, errorText) {
  if (provider !== "kiro" || Number(status) !== 403) return false;
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText || "");
  return text.includes(KIRO_SUSPENSION_REASON);
}

// Only connections disabled automatically by the Kiro suspension rule are
// restored. Manually disabled connections never have autoRetryReason/At.
export async function recoverScheduledConnections(provider = null) {
  const connections = await getProviderConnections(provider ? { provider } : {});
  const now = Date.now();
  let recovered = 0;

  for (const connection of connections) {
    if (connection.provider !== "kiro" || connection.isActive !== false) continue;
    if (connection.autoRetryReason !== KIRO_SUSPENSION_REASON || !connection.autoRetryAt) continue;
    const retryAt = new Date(connection.autoRetryAt).getTime();
    if (!Number.isFinite(retryAt) || retryAt > now) continue;

    await updateProviderConnection(connection.id, {
      isActive: true,
      testStatus: "unknown",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
      autoRetryAt: null,
      autoRetryReason: null,
    });
    recovered += 1;
  }

  return recovered;
}
