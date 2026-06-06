import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";

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
  // Split into numeric core segments and an optional pre-release tag
  // (e.g. "0.4.66-beta.1" -> { parts: [0,4,66], pre: "beta.1" }). Missing or
  // non-numeric segments default to 0 so versions with differing segment counts
  // still compare correctly.
  const parse = (v) => {
    const [main, pre] = String(v).split("-");
    const parts = main.split(".").map((n) => {
      const num = parseInt(n, 10);
      return Number.isFinite(num) ? num : 0;
    });
    return { parts, pre };
  };

  const pa = parse(a);
  const pb = parse(b);

  const maxLen = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < maxLen; i++) {
    const x = pa.parts[i] || 0;
    const y = pb.parts[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }

  // Equal numeric cores: a stable release outranks a pre-release of the same
  // core (semver: 0.4.66 > 0.4.66-beta).
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) {
    if (pa.pre > pb.pre) return 1;
    if (pa.pre < pb.pre) return -1;
  }

  return 0;
}

export async function GET() {
  const latestVersion = await fetchLatestVersion();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
