// This API route is called automatically to initialize app
import { getSettings } from "@/lib/db/repos/settingsRepo";
import { setSessionProbeEnabled, startSessionProbe } from "open-sse/utils/sessionProbe.js";

let probeBootstrapped = false;

export async function GET() {
  // Boot the read-only session probe once if it is enabled in settings or via env.
  // Guarded so repeated init calls do not stack intervals.
  if (!probeBootstrapped) {
    probeBootstrapped = true;
    try {
      const settings = await getSettings();
      setSessionProbeEnabled(!!settings.sessionProbeEnabled);
      if (settings.sessionProbeEnabled) startSessionProbe();
    } catch (err) {
      console.warn("[SessionProbe] init failed:", err?.message || err);
    }
  }
  return new Response("Initialized", { status: 200 });
}
