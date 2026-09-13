import fs from "fs";

// Container/PaaS deploys (Render, Fly, Cloud Run, Sevalla, plain Docker) have no global npm
// install to upgrade and no persistent fs: `npm i -g 9router` is a no-op there, and
// the shutdown step of the self-update flow just kills the instance. Update = redeploy.
// ponytail: env/cgroup sniff, not a build-time flag — set CONTAINER_DEPLOY=1 to force.
export function isContainerDeploy() {
  if (process.env.CONTAINER_DEPLOY === "1") return true;
  if (process.env.RENDER || process.env.FLY_APP_NAME || process.env.K_SERVICE || process.env.SVL_APP_ID) return true;
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}
