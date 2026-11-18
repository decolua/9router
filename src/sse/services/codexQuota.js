import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { getCodexQuotaPriority } from "@/shared/utils/codexQuota";

const snapshots = new Map();
const REFRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;

export function getCodexQuotaSnapshot(connection) {
  const entry = snapshots.get(connection.id);
  const accountId = connection.providerSpecificData?.workspaceId || connection.providerSpecificData?.accountId || connection.providerSpecificData?.chatgptAccountId;
  if (!entry || entry.token !== connection.accessToken || entry.accountId !== accountId || Date.now() - entry.updatedAt >= STALE_MS) return null;
  return entry.quotas;
}

async function refresh(connection) {
  if (!connection.accessToken) return;
  const now = Date.now();
  const accountId = connection.providerSpecificData?.workspaceId || connection.providerSpecificData?.accountId || connection.providerSpecificData?.chatgptAccountId;
  let entry = snapshots.get(connection.id);
  if (!entry || entry.token !== connection.accessToken || entry.accountId !== accountId) {
    entry = { token: connection.accessToken, accountId, attemptedAt: -Infinity, updatedAt: -Infinity };
    snapshots.set(connection.id, entry);
  }
  if (entry.pending) return entry.pending;
  if (now - entry.attemptedAt < REFRESH_MS) return;
  entry.attemptedAt = now;
  entry.pending = (async () => {
    try {
      const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
      const usage = await getCodexUsage(connection.accessToken, proxy, connection.providerSpecificData);
      if (usage?.quotas && !usage.message && Object.keys(usage.quotas).length) {
        entry.quotas = usage.quotas;
        entry.updatedAt = Date.now();
      }
    } catch {
      // A quota endpoint outage must not disable otherwise usable credentials.
    }
  })();
  try {
    await entry.pending;
  } finally {
    entry.pending = null;
  }
}

export async function refreshCodexQuotas(connections) {
  // ponytail: process-local, minute-old percentages; add shared reservations for exact multi-worker budgets.
  for (const [id, entry] of snapshots) {
    if (!entry.pending && Date.now() - entry.attemptedAt >= STALE_MS) snapshots.delete(id);
  }
  for (let i = 0; i < connections.length; i += 4) {
    await Promise.all(connections.slice(i, i + 4).map(refresh));
  }
}

export function selectCodexQuotaConnection(connections, model) {
  const candidates = connections.map(connection => {
    const quota = getCodexQuotaPriority(getCodexQuotaSnapshot(connection), connection.providerSpecificData?.codexQuota, model);
    const base = Number.isFinite(connection.priority) && connection.priority > 0 ? connection.priority : 1;
    return { connection, ...quota, weight: 1 / (base * quota.priority) };
  }).filter(candidate => !candidate.blocked);
  // Prefer measured accounts; unknown/stale quota falls back to base priority only if all readings are unavailable.
  const known = candidates.filter(candidate => candidate.known);
  const pool = known.length ? known : candidates;
  let draw = Math.random() * pool.reduce((sum, candidate) => sum + candidate.weight, 0);
  return pool.find(candidate => (draw -= candidate.weight) < 0)?.connection || pool.at(-1)?.connection;
}