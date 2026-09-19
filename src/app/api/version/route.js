import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache npm latest lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= { value: null, fetchedAt: 0 });

// Fetch latest version from npm registry
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
      { timeout: 4000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// Semantic compare, mirroring the fix 943b8f82 made in cli/cli.js: the old version
// here did Number("75-enhanced") -> NaN, and every comparison with NaN is false, so
// the dashboard update notice was permanently dead on fork builds ("0.5.76" vs
// "0.5.75-enhanced.1" answered "same version").
function parseVersionParts(v) {
  const s = String(v ?? "").trim().replace(/^v/i, "");
  const dash = s.indexOf("-");
  const base = dash === -1 ? s : s.slice(0, dash);
  const suffix = dash === -1 ? "" : s.slice(dash + 1);
  const nums = base.split(".").map((seg) => {
    const n = Number.parseInt(seg, 10);
    return Number.isNaN(n) ? 0 : n;
  });
  return { nums, suffix };
}

// Suffix ordering for equal numeric bases (e.g. two fork releases): dot-separated
// identifiers, numeric segments compared as numbers, shorter prefix loses.
function compareSuffix(a, b) {
  if (a === b) return 0;
  const sa = a.split(".");
  const sb = b.split(".");
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const x = sa[i];
    const y = sb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = Number.parseInt(x, 10);
    const ny = Number.parseInt(y, 10);
    const xNum = !Number.isNaN(nx);
    const yNum = !Number.isNaN(ny);
    if (xNum && yNum && nx !== ny) return nx > ny ? 1 : -1;
    if (xNum !== yNum) return xNum ? -1 : 1; // numeric identifiers rank below alphanumeric
    return x > y ? 1 : -1;
  }
  return 0;
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.nums.length, pb.nums.length, 3);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] || 0;
    const y = pb.nums[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // Same numeric base: an official release is NOT an upgrade over its fork build —
  // `npm i -g` would replace the fork wholesale (the 943b8f82 contract). Two suffixed
  // builds of the same base ARE ordered, so a newer fork release still announces itself.
  if (!pa.suffix || !pb.suffix) return 0;
  return compareSuffix(pa.suffix, pb.suffix);
}

// Exported for tests, same convention as src/dashboardGuard.js
export const __test__ = { compareVersions };

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
