import { CLIENT_PING_TIMEOUT_MS } from "../utils/endpointConstants";

export async function clientPingUrl(url) {
  if (!url) return false;
  try {
    await fetch(`${url}/api/health`, {
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(CLIENT_PING_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

export async function clientPingAny(...urls) {
  const checks = urls.filter(Boolean).map(clientPingUrl);
  if (!checks.length) return false;
  return new Promise((resolve) => {
    let pending = checks.length;
    checks.forEach((p) =>
      p.then((ok) => {
        if (ok) resolve(true);
        else if (--pending === 0) resolve(false);
      }),
    );
  });
}
