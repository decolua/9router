import { getSettings } from "@/lib/localDb";
import { setRtkEnabled } from "open-sse/rtk/flag.js";

let initialized = false;

export async function ensureRtkInitialized() {
  if (initialized) return true;
  try {
    const settings = await getSettings();
    setRtkEnabled(settings.rtkEnabled === true);
    initialized = true;
  } catch (error) {
    console.error("[ServerInit] Error initializing RTK flag:", error);
  }
  return initialized;
}

ensureRtkInitialized().catch(console.log);

export default ensureRtkInitialized;
