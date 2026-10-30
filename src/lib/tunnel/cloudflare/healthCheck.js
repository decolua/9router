import dns from "dns";
import https from "https";
import { resolveDns } from "../shared/dnsResolver.js";
import { HEALTH_CHECK } from "./config.js";

// Prefer public DNS for the probe: local/router resolvers often filter
// *.trycloudflare.com, which makes a healthy tunnel probe as dead (530/timeout).
const publicResolver = new dns.Resolver();
publicResolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

const resolve4ViaPublic = (hostname) =>
  new Promise((resolve) => {
    publicResolver.resolve4(hostname, (error, addresses) => {
      resolve(error || !addresses?.length ? null : addresses[0]);
    });
  });

const ipv4Lookup = async (hostname, options, callback) => {
  const viaPublic = await resolve4ViaPublic(hostname);
  if (viaPublic) {
    // Node passes all:true for https agents; that callback form requires an array.
    return callback(null, options?.all ? [{ address: viaPublic, family: 4 }] : viaPublic, 4);
  }
  dns.resolve4(hostname, (error, addresses) => {
    if (error || !addresses?.length) return callback(error || new Error("No IPv4 address"));
    return callback(null, options?.all ? [{ address: addresses[0], family: 4 }] : addresses[0], 4);
  });
};

export async function probeUrlAlive(url) {
  if (!url) return false;
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return false; }
  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  return new Promise((resolve) => {
    const request = https.get(`${url}/api/health`, { lookup: ipv4Lookup, timeout: HEALTH_CHECK.fetchTimeoutMs }, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
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
