import path from "node:path";
import { loadRuntimeDep } from "../../../open-sse/services/lazyRuntime.js";
import { ensureVirtualDisplay } from "../../../open-sse/services/virtualDisplay.js";
import { getWritableDataDir } from "../../../open-sse/utils/writableDataDir.js";

const PROFILE_DIR = path.join(getWritableDataDir(), "browser-profiles", "zcode-captcha");
let context = null;
let mode = null;

export async function launchZcodeContext(headless = true) {
  const nextMode = headless ? "headless" : "headed";
  if (context && mode === nextMode) return context;
  await closeZcodeContext();

  const { launchPersistentContext } = await loadRuntimeDep("cloakbrowser");
  const launchOptions = {
    userDataDir: PROFILE_DIR,
    headless,
    humanize: !headless,
    args: ["--no-sandbox", "--no-first-run", "--disable-default-apps"],
  };
  if (!headless) {
    const display = await ensureVirtualDisplay();
    if (display) launchOptions.launchOptions = { env: { ...process.env, DISPLAY: display } };
  }
  context = await launchPersistentContext(launchOptions);
  mode = nextMode;
  return context;
}

export async function closeZcodeContext() {
  const current = context;
  context = null;
  mode = null;
  await current?.close().catch(() => {});
}
