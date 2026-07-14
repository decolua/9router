import { shouldForceStrictProxy } from "@/lib/network/strictProxyPolicy";

const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const DEFAULT_TIMEOUT_MS = 5000;

function countStrictConnections(connections = []) {
  return connections.filter((connection) => {
    if (!shouldForceStrictProxy(connection?.provider)) return false;
    const nested = connection?.providerSpecificData;
    return connection?.strictProxy === true
      && nested
      && typeof nested === "object"
      && nested.strictProxy === true;
  }).length;
}

export async function checkWarpHealth({
  settings = {},
  listConnections,
  probe,
  now = () => new Date(),
} = {}) {
  const connections = typeof listConnections === "function" ? await listConnections() : [];
  const strictConnections = countStrictConnections(Array.isArray(connections) ? connections : []);
  const checkedAt = new Date(now()).toISOString();
  const configured = settings?.outboundProxyEnabled === true
    && Boolean(String(settings?.outboundProxyUrl || "").trim());

  if (!configured) {
    return {
      configured: false,
      reachable: false,
      warp: false,
      strictConnections,
      checkedAt,
      status: "not_configured",
    };
  }

  let probeResult = { ok: false, body: "" };
  try {
    probeResult = await probe({
      proxyUrl: settings.outboundProxyUrl,
      testUrl: TRACE_URL,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  } catch {
    probeResult = { ok: false, body: "" };
  }

  const reachable = probeResult?.ok === true;
  const body = typeof probeResult?.body === "string" ? probeResult.body : "";
  const warp = reachable && /(?:^|\n)warp=on(?:\n|$)/.test(body);
  const status = !reachable ? "unreachable" : warp ? "healthy" : "warp_off";

  return {
    configured: true,
    reachable,
    warp,
    strictConnections,
    checkedAt,
    status,
  };
}


export async function probeWarpTrace({ proxyUrl, testUrl, timeoutMs } = {}) {
  const { testProxyUrl } = await import("@/lib/network/proxyTest");
  const { createProxyDispatcher, disposeProxyDispatcher } = await import("@/lib/network/proxyDispatcher");
  const { fetch: undiciFetch } = await import("undici");
  // Prefer a GET body for warp=on detection; fall back to HEAD-only testProxyUrl.
  let dispatcher;
  try {
    dispatcher = await createProxyDispatcher(proxyUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(Number(timeoutMs) || 5000, 5000));
    try {
      const res = await undiciFetch(testUrl, {
        method: "GET",
        dispatcher,
        signal: controller.signal,
        headers: { "User-Agent": "9Router" },
      });
      const body = await res.text();
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    const result = await testProxyUrl({ proxyUrl, testUrl, timeoutMs });
    return { ok: result.ok === true, status: result.status, body: "" };
  } finally {
    if (dispatcher) disposeProxyDispatcher(dispatcher);
  }
}
