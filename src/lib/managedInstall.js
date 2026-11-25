import { existsSync } from "node:fs";

export const MANAGED_UPDATE_MESSAGE = "Run update inside the Community Scripts container during a maintenance window.";

export function isCommunityScriptsInstall(env = process.env, exists = existsSync) {
  return env.NINEROUTER_INSTALL_TYPE === "community-scripts" ||
    (env.DATA_DIR === "/opt/9router_data" && exists("/etc/systemd/system/9router.service") && exists("/usr/bin/update"));
}

export function managedUpdateConflict() {
  if (!isCommunityScriptsInstall()) return null;
  return Response.json({ success: false, code: "managed_install", message: MANAGED_UPDATE_MESSAGE }, { status: 409 });
}
