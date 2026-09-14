import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache npm latest lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__npmVersionCache ??= { value: null, fetchedAt: 0 });

// Fetch latest version / commit from custom repo or npm registry
function fetchLatestRepoUpdate() {
  return new Promise((resolve) => {
    // Check GitHub commits on serenhope/9router repo for updates
    const req = https.get(
      "https://api.github.com/repos/serenhope/9router/commits/master",
      {
        timeout: 4000,
        headers: {
          "User-Agent": "9Router-App",
          "Accept": "application/vnd.github.v3+json"
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.sha) {
              resolve({ sha: parsed.sha.slice(0, 7), message: parsed.commit?.message?.split("\n")[0] || "" });
            } else {
              resolve(null);
            }
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

async function getLatestUpdateCached() {
  if (versionCache.value && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  const latest = await fetchLatestRepoUpdate();
  if (latest) {
    versionCache.value = latest;
    versionCache.fetchedAt = Date.now();
  }
  return latest;
}

export async function GET() {
  const latestCommit = await getLatestUpdateCached();
  const currentVersion = pkg.version;

  return Response.json({
    currentVersion,
    latestVersion: latestCommit ? `git-${latestCommit.sha}` : currentVersion,
    commitMessage: latestCommit?.message || "",
    hasUpdate: false, // Turned into passive alert check
  });
}
