import https from "https";
import type { JsonValue } from "open-sse/types/executor.js";
import pkg from "../../../../package.json" with { type: "json" };

const NPM_PACKAGE_NAME = "9router";

function fetchLatestVersion() {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const req = https.get(
    `https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`,
    { timeout: 4000 },
    (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed: JsonValue = JSON.parse(data) as JsonValue;
          resolve(
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed) &&
            typeof parsed["version"] === "string"
              ? parsed["version"]
              : null
          );
        } catch {
          resolve(null);
        }
      });
    }
  );
  req.on("error", () => resolve(null));
  req.on("timeout", () => { req.destroy(); resolve(null); });
  return promise;
}

function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

export async function GET() {
  const latestVersion = await fetchLatestVersion();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
