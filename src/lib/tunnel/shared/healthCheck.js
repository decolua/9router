import { resolveDns } from "./dnsResolver.js";

/**
 * Builds the health-check probe helpers for a tunnel provider.
 *
 * The probe logic is identical for every provider; only the timing config
 * differs, so each tunnel module passes its own HEALTH_CHECK config here.
 *
 * @param {{ intervalMs: number, timeoutMs: number, fetchTimeoutMs: number, dnsTimeoutMs: number }} config
 * @param {{ resolveDns?: Function, fetch?: Function }} [deps] Overrides for tests.
 * @returns {{ probeUrlAlive: (url: string) => Promise<boolean>, waitForHealth: (url: string, cancelToken?: { cancelled: boolean }) => Promise<boolean> }}
 */
export function createHealthCheck(config, deps = {}) {
  const resolveHost = deps.resolveDns ?? resolveDns;
  const doFetch = deps.fetch ?? fetch;

  async function probeUrlAlive(url) {
    if (!url) return false;
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return false;
    }

    if (!(await resolveHost(hostname, config.dnsTimeoutMs))) return false;

    try {
      const res = await doFetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(config.fetchTimeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function waitForHealth(url, cancelToken = { cancelled: false }) {
    const start = Date.now();
    while (Date.now() - start < config.timeoutMs) {
      if (cancelToken.cancelled) throw new Error("cancelled");
      if (await probeUrlAlive(url)) return true;
      await new Promise((r) => setTimeout(r, config.intervalMs));
    }
    throw new Error(`Health check timeout after ${config.timeoutMs}ms`);
  }

  return { probeUrlAlive, waitForHealth };
}
