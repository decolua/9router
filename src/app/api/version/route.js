import https from "https";
import fs from "fs";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache npm latest lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= { value: null, fetchedAt: 0 });

// Detect if the app is running inside a Docker container.
// /.dockerenv exists in every Docker container; cgroup also shows docker.
function isRunningInDocker() {
  try {
    if (fs.existsSync("/.dockerenv")) return true;
  } catch { /* ignore */ }
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    if (typeof cgroup === "string" && /docker|containerd/.test(cgroup)) return true;
  } catch { /* ignore */ }
  return false;
}

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
  const isDocker = isRunningInDocker();
  const hasDockerAutoUpdate = isDocker && !!process.env.DOCKER_UPDATE_TRIGGER_FILE;

  return Response.json({
    currentVersion,
    latestVersion,
    hasUpdate,
    isDocker,
    // "docker" = run docker compose pull && up -d on the host
    // "npm" = run npm i -g 9router@latest (CLI/npm install)
    updateMethod: hasDockerAutoUpdate ? "docker-auto" : isDocker ? "docker" : "npm",
  });
}
