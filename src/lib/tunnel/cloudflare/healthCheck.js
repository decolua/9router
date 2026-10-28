import { resolveDns } from "../shared/dnsResolver.js";
import { HEALTH_CHECK, WORKER_URL } from "./config.js";
import { workerFetch } from "./workerFetch.js";

const WORKER_HOST = (() => {
  try { return new URL(WORKER_URL).hostname; }
  catch { return null; }
})();

export async function probeUrlAlive(url) {
  if (!url) return false;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  // Worker host may serve a self-signed chain (Cloudflare Access origin).
  // Use workerFetch so TUNNEL_WORKER_INSECURE is respected; global fetch
  // would reject the cert silently. Other hosts use plain fetch.
  const isWorker = WORKER_HOST && hostname === WORKER_HOST;
  try {
    const res = isWorker
      ? await workerFetch(`${url}/api/health`, {
          signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
        })
      : await fetch(`${url}/api/health`, {
          signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
        });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(url, cancelToken = { cancelled: false }) {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}
