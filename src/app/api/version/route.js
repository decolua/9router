import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";
const ENABLE_NPM_UPDATE_CHECK = process.env.ENABLE_NPM_UPDATE_CHECK === "true";

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

export async function GET() {
  const currentVersion = pkg.version;
  if (!ENABLE_NPM_UPDATE_CHECK) {
    return Response.json({
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      source: "app"
    });
  }

  const latestVersion = await fetchLatestVersion();
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({
    currentVersion,
    latestVersion: latestVersion || currentVersion,
    hasUpdate,
    source: "npm",
    installCommand: hasUpdate ? `npm install -g ${NPM_PACKAGE_NAME}@latest` : null
  });
}
