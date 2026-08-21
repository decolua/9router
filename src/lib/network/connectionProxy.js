import { getProxyPoolById } from "@/models";
import { fitPoolIds, loadPoolFitness } from "open-sse/services/proxyPoolFitness.js";

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeLegacyProxy(providerSpecificData = {}) {
  return {
    connectionProxyEnabled: providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: normalizeString(providerSpecificData?.connectionProxyUrl),
    connectionNoProxy: normalizeString(providerSpecificData?.connectionNoProxy),
  };
}

export async function resolveConnectionProxyConfig(providerSpecificData = {}, connectionId = null, excludePoolIds = null) {
  try {
    const proxyPoolIdRaw = normalizeString(providerSpecificData?.proxyPoolId);
    const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
    const proxyPoolIds = Array.isArray(providerSpecificData?.proxyPoolIds) ? providerSpecificData.proxyPoolIds : [];
    const strategy = providerSpecificData?.proxyRotationStrategy || "none";
    const scope = providerSpecificData?.proxyPoolScope || null;
    const excludedPoolIds = excludePoolIds instanceof Set
      ? [...excludePoolIds]
      : Array.isArray(excludePoolIds) ? excludePoolIds : [];
    if (strategy === "smart" && scope) await Promise.all(proxyPoolIds.map((id) => loadPoolFitness(id)));
    const selectedPoolId = proxyPoolIds.length
      ? pickProxyPoolId(proxyPoolIds, strategy, connectionId || "", providerSpecificData?.targetProxyPoolIds || [], { scope, excludeIds: excludedPoolIds })
      : excludedPoolIds.includes(proxyPoolId) ? null : proxyPoolId;
    const legacy = normalizeLegacyProxy(providerSpecificData);

    if (selectedPoolId) {
      const proxyPool = await getProxyPoolById(selectedPoolId);
      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);
      if (proxyPool && proxyPool.isActive === true && proxyUrl) {
        if (["vercel", "cloudflare", "deno"].includes(proxyPool.type)) {
          return { source: proxyPool.type, proxyPoolId: selectedPoolId, proxyPool, connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: noProxy, strictProxy: proxyPool.strictProxy === true, vercelRelayUrl: proxyUrl };
        }
        return { source: "pool", proxyPoolId: selectedPoolId, proxyPool, connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, connectionNoProxy: noProxy, strictProxy: proxyPool.strictProxy === true };
      }
    }

    if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) return { source: "legacy", proxyPoolId: selectedPoolId || null, proxyPool: null, ...legacy };
    if (scope?.startsWith("freebuff::")) return { source: "pool", proxyPoolId: null, proxyPool: null, noFitPool: true, connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", strictProxy: true };
    return { source: "none", proxyPoolId: proxyPoolId || null, proxyPool: null, ...legacy };
  } catch (error) {
    console.error("[resolveConnectionProxyConfig] Failed to resolve proxy config:", error);
    const freebuffScope = providerSpecificData?.proxyPoolScope?.startsWith("freebuff::") === true;
    return { source: "error", proxyPoolId: null, proxyPool: null, connectionProxyEnabled: false, connectionProxyUrl: "", connectionNoProxy: "", noFitPool: freebuffScope, strictProxy: freebuffScope };
  }
}

const poolCursors = new Map();

function normalizeTargetPoolIds(targetProxyPoolIds) {
  if (!Array.isArray(targetProxyPoolIds)) return [];
  return [...new Set(targetProxyPoolIds.map(normalizeString).filter(Boolean))];
}

export function filterTargetProxyPoolIds(poolIds, targetProxyPoolIds = []) {
  if (!Array.isArray(poolIds) || poolIds.length === 0) return [];
  const targets = normalizeTargetPoolIds(targetProxyPoolIds);
  if (targets.length === 0) return poolIds;
  const allowed = new Set(targets);
  return poolIds.filter((id) => allowed.has(id));
}

export function pickProxyPoolId(poolIds, strategy, providerId = "", targetProxyPoolIds = [], options = {}) {
  if (!Array.isArray(targetProxyPoolIds)) {
    options = targetProxyPoolIds || {};
    targetProxyPoolIds = [];
  }
  let eligiblePoolIds = filterTargetProxyPoolIds(poolIds, targetProxyPoolIds);
  const normalizedStrategy = String(strategy || "").toLowerCase();
  const { scope = null, excludeIds = [] } = options || {};
  eligiblePoolIds = eligiblePoolIds.filter((id) => !excludeIds.includes(id));
  const fitnessApplied = normalizedStrategy === "smart" && !!scope;
  if (fitnessApplied) eligiblePoolIds = fitPoolIds(eligiblePoolIds, scope);
  if (eligiblePoolIds.length === 0 && !fitnessApplied) eligiblePoolIds = filterTargetProxyPoolIds(poolIds, targetProxyPoolIds).filter((id) => !excludeIds.includes(id));
  if (eligiblePoolIds.length === 0) return null;
  if (normalizedStrategy === "fill-first") return eligiblePoolIds[0];
  if (normalizedStrategy === "round-robin" || normalizedStrategy === "smart") {
    const key = `${providerId}:${normalizedStrategy}:${eligiblePoolIds.join(",")}`;
    const index = (poolCursors.get(key) ?? 0) % eligiblePoolIds.length;
    poolCursors.set(key, (index + 1) % eligiblePoolIds.length);
    return eligiblePoolIds[index];
  }
  if (normalizedStrategy === "random") return eligiblePoolIds[Math.floor(Math.random() * eligiblePoolIds.length)];
  return eligiblePoolIds[0];
}
