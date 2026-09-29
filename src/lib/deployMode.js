import fs from "fs";

// Deploy Environment module.
// A hosted deploy (PaaS / container / ephemeral VM) has no global npm install to
// upgrade and no persistent fs: `npm i -g 9router` is a no-op there, and the
// shutdown step of the self-update flow just kills the instance. Update = redeploy.
// Detection is data-driven: one row per platform. Adding a PaaS = one detector,
// never a code edit scattered across callers. Set CONTAINER_DEPLOY=1 to force.
const DETECTORS = [
  { id: "override", detect: () => process.env.CONTAINER_DEPLOY === "1" },
  { id: "render", detect: () => !!process.env.RENDER },
  { id: "fly", detect: () => !!process.env.FLY_APP_NAME },
  { id: "cloudrun", detect: () => !!process.env.K_SERVICE },
  // Sevalla exposes no dedicated env var; BASE_URL on its *.sevalla.app domain is
  // the only reliable runtime signal. ponytail: URL heuristic, swap for a SEVALLA_*
  // env var if/when the platform exposes one.
  { id: "sevalla", detect: () => typeof process.env.BASE_URL === "string" && process.env.BASE_URL.endsWith(".sevalla.app") },
  { id: "docker", detect: () => { try { return fs.existsSync("/.dockerenv"); } catch { return false; } } },
];

export function isHosted() {
  return DETECTORS.some((d) => d.detect());
}

// Back-compat alias: callers migrate lazily; both names answer the same question.
export const isContainerDeploy = isHosted;
