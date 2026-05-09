import net from "net";
import dns from "dns";
import { INTERNET_CHECK, HEALTH_CHECK } from "./tunnelConfig.js";

// Force public DNS to bypass OS negative cache (mDNSResponder holds NXDOMAIN)
const resolver = new dns.promises.Resolver();
resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

export function checkInternet() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(INTERNET_CHECK.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try { socket.connect(INTERNET_CHECK.port, INTERNET_CHECK.host); }
    catch { finish(false); }
  });
}

async function resolveDns(hostname, timeoutMs) {
  // Try custom public DNS first (bypasses negative-cached NXDOMAIN on macOS).
  // Fall back to OS resolver for hostnames blocked or unsupported by Cloudflare DNS
  // (e.g. *.ts.net not always resolvable via 1.1.1.1).
  const tryResolver = (fn) => Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("dns timeout")), timeoutMs)),
  ]).then(() => true).catch(() => false);

  if (await tryResolver(() => resolver.resolve4(hostname))) return true;
  return tryResolver(() => dns.promises.resolve4(hostname));
}

// Single health probe: DNS via 1.1.1.1 → fetch /api/health
export async function probeUrlAlive(url) {
  if (!url) return false;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Poll until tunnel responds /api/health, or timeout. Cancellable via token.
export async function waitForHealth(url, cancelToken = { cancelled: false }) {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}
