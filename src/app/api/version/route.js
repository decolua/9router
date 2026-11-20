import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache npm latest lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= { value: null, fetchedAt: 0 });

// Fetch latest version from npm registry (uses fetch() — works on Node, Bun, and CF Workers)
async function fetchLatestVersion() {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

async function getLatestVersionCached() {
  if (versionCache.value && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  const latest = await fetchLatestVersion();
  if (latest) {
    versionCache.value = latest;
    versionCache.fetchedAt = Date.now();
  }
  return latest;
}

export async function GET() {
  const latestVersion = await getLatestVersionCached();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
