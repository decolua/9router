import semver from "semver";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const CACHE_KEY = Symbol.for("9router.forkVersionCache");
const versionCache = (globalThis[CACHE_KEY] ??= new Map());

export function normalizeVersion(version) {
  if (typeof version !== "string") return null;
  return semver.valid(version.trim()) || null;
}

export function normalizeForkVersion(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  const prerelease = semver.prerelease(normalized);
  return prerelease?.[0] === "fork" && prerelease.length >= 2 ? normalized : null;
}

export function upstreamBaseVersion(version) {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  const parsed = semver.parse(normalized);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function evaluateVersionPolicy({ currentVersion, upstreamLatestVersion, forkLatestVersion }) {
  const current = normalizeVersion(currentVersion);
  const upstreamLatest = normalizeVersion(upstreamLatestVersion);
  const forkLatest = normalizeForkVersion(forkLatestVersion);

  const forkUpdateAvailable = Boolean(
    current && forkLatest && semver.gt(forkLatest, current)
  );

  const newestKnownFork = current && forkLatest
    ? (semver.gt(forkLatest, current) ? forkLatest : current)
    : (forkLatest || current);
  const integratedUpstreamVersion = upstreamBaseVersion(newestKnownFork);
  const upstreamUpdatePending = Boolean(
    upstreamLatest &&
    integratedUpstreamVersion &&
    semver.gt(upstreamLatest, integratedUpstreamVersion)
  );

  return {
    currentVersion: current || null,
    forkLatestVersion: forkLatest,
    upstreamLatestVersion: upstreamLatest,
    integratedUpstreamVersion,
    forkUpdateAvailable,
    upstreamUpdatePending,
    // Backward-compatible alias for older dashboard clients.
    hasUpdate: forkUpdateAvailable,
  };
}

export function registryLatestUrl(packageName) {
  return `${UPDATER_CONFIG.npmRegistryBaseUrl}/${encodeURIComponent(packageName)}/latest`;
}

export async function fetchRegistryLatest(
  packageName,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = UPDATER_CONFIG.registryRequestTimeoutMs,
  } = {}
) {
  if (typeof fetchImpl !== "function") return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(registryLatestUrl(packageName), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response?.ok) return null;
    const payload = await response.json();
    return normalizeVersion(payload?.version);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCachedRegistryLatest(
  packageName,
  {
    cache = versionCache,
    now = Date.now,
    ttlMs = UPDATER_CONFIG.versionCacheTtlMs,
    fetchImpl,
    timeoutMs,
  } = {}
) {
  const cached = cache.get(packageName);
  const timestamp = now();
  if (cached && timestamp - cached.fetchedAt < ttlMs) {
    return cached.version;
  }

  const version = await fetchRegistryLatest(packageName, { fetchImpl, timeoutMs });
  if (version) cache.set(packageName, { version, fetchedAt: timestamp });
  return version;
}

export async function getVersionStatus({
  currentVersion,
  fetchImpl,
  cache = versionCache,
  now,
} = {}) {
  const lookupOptions = { fetchImpl, cache, now };
  const [upstreamLatestVersion, forkLatestVersion] = await Promise.all([
    getCachedRegistryLatest(UPDATER_CONFIG.upstreamNpmPackageName, lookupOptions),
    getCachedRegistryLatest(UPDATER_CONFIG.npmPackageName, lookupOptions),
  ]);

  return {
    ...evaluateVersionPolicy({
      currentVersion,
      upstreamLatestVersion,
      forkLatestVersion,
    }),
    updatePackageName: UPDATER_CONFIG.npmPackageName,
    installCommand: UPDATER_CONFIG.installCmdLatest,
  };
}

export function clearVersionCache() {
  versionCache.clear();
}
