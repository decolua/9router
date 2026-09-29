function sanitize(value, fallback = "Unavailable") {
  const text = String(value || fallback)
    .replace(/(?:set-cookie|cookie|authorization|headers?)\s*[:=][^\r\n]*/gi, "[redacted-header]")
    .replace(/\b(?:bearer|basic)\s+[^\s,;]+(?:\s+[^\s,;]+)*/gi, "[redacted-credential]")
    .replace(/\btoken\s*=\s*[^\s,;]+/gi, "token=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\{[^}]{0,512}\}|\[[^\]]{0,512}\]/g, "[redacted-fragment]")
    .replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 256);
}

function resetAt(value) {
  const parsed = typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)
    ? new Date(value).getTime()
    : Number(value);
  return Number.isFinite(parsed) && parsed > Date.now() ? parsed : null;
}

export function poolSnapshotKey(provider, connectionId, model) {
  return `${provider}\u0000${connectionId}\u0000${model}`;
}

export function configuredPoolIds(credentials) {
  const data = credentials?._connection?.providerSpecificData || credentials?.providerSpecificData || {};
  return Object.freeze([...new Set([
    ...(Array.isArray(data.proxyPoolIds) ? data.proxyPoolIds : []), data.proxyPoolId,
  ].map((id) => String(id || "").trim()).filter(Boolean))]);
}

export function createTerminalAccumulator() {
  let quota = null;
  let exhausted = false;
  let provider = null;
  return {
    record(result) {
      const reset = resetAt(result?.resetsAtMs);
      if (Number(result?.status) === 429 && reset && (!quota || reset < quota.reset)) {
        quota = { reset, message: sanitize(result.error, "Quota exhausted") };
      }
      if (result) provider = { status: Number(result.status) || 503, message: sanitize(result.error) };
    },
    poolExhausted() { exhausted = true; },
    value() {
      if (quota) return { kind: "quota", status: 429, reset: quota.reset, message: quota.message };
      if (exhausted) return { kind: "pool", status: 503, message: "Freebuff proxy pool attempts exhausted" };
      return { kind: "provider", status: provider?.status || 503, message: provider?.message || "All accounts unavailable" };
    },
  };
}

export async function routeFiniteFreebuff({ provider, model, select, resolvePool, dispatch, shouldFallback }) {
  const excludedConnectionIds = new Set();
  const excludedPoolIdentities = new Set();
  const snapshots = new Map();
  const terminal = createTerminalAccumulator();

  while (true) {
    const selected = await select(excludedConnectionIds);
    if (selected?.allRateLimited) {
      terminal.record({ status: 429, resetsAtMs: selected.retryAfter, error: selected.lastError || "Quota exhausted" });
      return { terminal: terminal.value(), snapshots, excludedConnectionIds, excludedPoolIdentities };
    }
    if (!selected) return { terminal: terminal.value(), snapshots, excludedConnectionIds, excludedPoolIdentities };
    if (excludedConnectionIds.has(selected.connectionId)) return { terminal: terminal.value(), snapshots, excludedConnectionIds, excludedPoolIdentities };

    const key = poolSnapshotKey(provider, selected.connectionId, model);
    if (!snapshots.has(key)) {
      const eligible = [];
      for (const poolId of configuredPoolIds(selected)) {
        const credentials = await resolvePool(selected, poolId);
        if (credentials?.providerSpecificData?.proxyPoolId === poolId && !credentials.providerSpecificData.noFitPool) {
          eligible.push(Object.freeze({ poolId, credentials }));
        }
      }
      snapshots.set(key, Object.freeze(eligible));
    }

    const snapshot = snapshots.get(key);
    if (snapshot.length === 0) {
      terminal.poolExhausted();
      excludedConnectionIds.add(selected.connectionId);
      continue;
    }

    let accountFailed = false;
    for (const entry of snapshot) {
      const identity = `${key}\u0000${entry.poolId}`;
      if (excludedPoolIdentities.has(identity)) continue;
      const result = await dispatch(entry.credentials);
      if (result.success) return { response: result.response, snapshots, excludedConnectionIds, excludedPoolIdentities };
      terminal.record(result);
      if (result.poolScoped?.poolId === entry.poolId) {
        excludedPoolIdentities.add(identity);
        continue;
      }
      if (await shouldFallback(entry.credentials, result)) {
        excludedConnectionIds.add(selected.connectionId);
        accountFailed = true;
        break;
      }
      return { terminal: terminal.value(), snapshots, excludedConnectionIds, excludedPoolIdentities };
    }
    if (!accountFailed) {
      terminal.poolExhausted();
      excludedConnectionIds.add(selected.connectionId);
    }
  }
}

export { sanitize as sanitizeTerminalMessage };
