import { launch as cbLaunch } from "cloakbrowser";
import path from "node:path";
import os from "node:os";

const USER_DATA_DIR = path.join(os.homedir(), ".cloakbrowser", "profiles", "9router-zcode");

let browserInstance = null;
let currentMode = null;

export async function launch(opts = {}) {
  const headless = opts.headless !== false;
  const requestedMode = headless ? "headless" : "headed";

  if (browserInstance && currentMode === requestedMode) {
    try {
      browserInstance.contexts();
      return browserInstance;
    } catch {
      browserInstance = null;
    }
  }

  if (browserInstance) {
    await close();
  }

  browserInstance = await cbLaunch({
    headless,
    userDataDir: USER_DATA_DIR,
    args: ["--no-sandbox", "--no-first-run", "--disable-default-apps"],
  });

  browserInstance.on("disconnected", () => {
    browserInstance = null;
    currentMode = null;
  });

  currentMode = requestedMode;
  return browserInstance;
}

export async function close() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // ignore
    }
    browserInstance = null;
    currentMode = null;
  }
}
