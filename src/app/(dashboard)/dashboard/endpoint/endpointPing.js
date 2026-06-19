import { CLIENT_PING_TIMEOUT_MS } from "./endpointConstants";

// Browser-side health probe: must reach origin (not just CF/TS edge).
// cors mode → res.ok=false for 5xx (e.g. Cloudflare 530 when origin dead).
// /api/health route sets Access-Control-Allow-Origin: * → CORS works through tunnel.
export async function clientPingUrl(url) {
  if (!url) return false;
  try {
    const res = await fetch(`${url}/api/health`, {
      mode: "cors",
      cache: "no-store",
      signal: AbortSignal.timeout(CLIENT_PING_TIMEOUT_MS),
    });
    return res.ok;
  } catch { return false; }
}

// Race multiple URLs: resolve true as soon as any one passes ping.
export async function clientPingAny(...urls) {
  const checks = urls.filter(Boolean).map(clientPingUrl);
  if (!checks.length) return false;
  return new Promise((resolve) => {
    let pending = checks.length;
    checks.forEach((p) => p.then((ok) => {
      if (ok) resolve(true);
      else if (--pending === 0) resolve(false);
    }));
  });
}
