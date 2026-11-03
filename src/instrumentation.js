export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    // Auto-start headroom proxy on boot if enabled and targeting loopback
    try {
      const { getSettings } = await import("@/lib/localDb");
      const settings = await getSettings();
      if (settings?.headroomEnabled) {
        const { isLoopbackHeadroomUrl, probeProxyRunning, DEFAULT_HEADROOM_URL, parsePortFromUrl } = await import("@/lib/headroom/detect");
        const url = settings.headroomUrl || DEFAULT_HEADROOM_URL;
        if (isLoopbackHeadroomUrl(url)) {
          const isRunning = await probeProxyRunning(url);
          if (!isRunning) {
            const { startHeadroomProxy } = await import("@/lib/headroom/process");
            const port = parsePortFromUrl(url);
            startHeadroomProxy({
              port,
              codeAware: settings.headroomCodeAware === true,
              kompress: settings.headroomKompress !== false,
            }).catch(() => {});
          }
        }
      }
    } catch {}
  }
}
