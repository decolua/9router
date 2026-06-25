import { getProviderConnections, getSettings, updateProviderConnection } from "@/lib/localDb";

function toTime(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export function normalizeQuotaRows(usage) {
  if (!usage?.quotas || typeof usage.quotas !== "object") return [];
  return Object.entries(usage.quotas).map(([name, quota]) => {
    const total = Number(quota?.total ?? 0);
    const used = Number(quota?.used ?? 0);
    const remainingPercentage = quota?.remainingPercentage !== undefined
      ? Number(quota.remainingPercentage)
      : total > 0
        ? Math.max(0, Math.round(((total - used) / total) * 100))
        : null;
    return {
      name,
      total: Number.isFinite(total) ? total : 0,
      used: Number.isFinite(used) ? used : 0,
      resetAt: quota?.resetAt || null,
      remainingPercentage: Number.isFinite(remainingPercentage) ? remainingPercentage : null,
    };
  });
}

export function buildQuotaSnapshot(usage) {
  const rows = normalizeQuotaRows(usage);
  return {
    quotas: rows,
    plan: usage?.plan || null,
    message: usage?.message || null,
    savedAt: new Date().toISOString(),
  };
}

export function getQuotaAutoState(usage) {
  const rows = normalizeQuotaRows(usage);
  const depleted = rows.filter((q) => {
    if (!q.total || q.total <= 0) return false;
    if (q.used >= q.total) return true;
    return q.remainingPercentage !== null && q.remainingPercentage <= 0;
  });

  const resetTimes = depleted
    .map((q) => toTime(q.resetAt))
    .filter((t) => t && t > Date.now())
    .sort((a, b) => a - b);

  return {
    exhausted: depleted.length > 0,
    reason: depleted.map((q) => q.name).join(", "),
    resetAt: resetTimes.length ? new Date(resetTimes[0]).toISOString() : null,
  };
}

export async function syncConnectionQuotaState(connection, usage) {
  if (!connection?.id) return connection;
  const snapshot = buildQuotaSnapshot(usage);
  const snapshotUpdate = {
    lastQuotaSnapshot: snapshot,
    lastQuotaSnapshotAt: snapshot.savedAt,
  };
  const settings = await getSettings();
  if (settings.quotaAutoToggleEnabled === false) {
    return await updateProviderConnection(connection.id, snapshotUpdate);
  }
  const state = getQuotaAutoState(usage);

  if (state.exhausted) {
    if (connection.isActive === false && !connection.quotaAutoDisabled) {
      return await updateProviderConnection(connection.id, snapshotUpdate);
    }
    return await updateProviderConnection(connection.id, {
      ...snapshotUpdate,
      isActive: false,
      quotaAutoDisabled: true,
      quotaAutoDisabledAt: new Date().toISOString(),
      quotaAutoDisabledUntil: state.resetAt,
      quotaAutoDisabledReason: state.reason || "quota exhausted",
      testStatus: "unavailable",
      lastError: state.reason ? `Quota exhausted: ${state.reason}` : "Quota exhausted",
      lastErrorAt: new Date().toISOString(),
    });
  }

  if (connection.quotaAutoDisabled) {
    return await updateProviderConnection(connection.id, {
      ...snapshotUpdate,
      isActive: true,
      quotaAutoDisabled: false,
      quotaAutoDisabledAt: null,
      quotaAutoDisabledUntil: null,
      quotaAutoDisabledReason: null,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
  }

  return await updateProviderConnection(connection.id, snapshotUpdate);
}

export async function restoreExpiredAutoDisabledConnections(provider = null) {
  const settings = await getSettings();
  if (settings.quotaAutoToggleEnabled === false) return [];
  const connections = await getProviderConnections(provider ? { provider } : {});
  const now = Date.now();
  const restored = [];

  for (const connection of connections) {
    if (!connection.quotaAutoDisabled || connection.isActive !== false) continue;
    const until = toTime(connection.quotaAutoDisabledUntil);
    if (!until || until > now) continue;
    const updated = await updateProviderConnection(connection.id, {
      isActive: true,
      quotaAutoDisabled: false,
      quotaAutoDisabledAt: null,
      quotaAutoDisabledUntil: null,
      quotaAutoDisabledReason: null,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
    if (updated) restored.push(updated);
  }

  return restored;
}
