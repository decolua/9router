function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// Back-compat read: prefer DURINDOOR_PROXY_* names; fall back to NINE_ROUTER_PROXY_* if unset.
function readProxyManaged() {
  return (
    process.env.DURINDOOR_PROXY_MANAGED ??
    process.env.NINE_ROUTER_PROXY_MANAGED
  );
}
function readProxyUrl() {
  return (
    process.env.DURINDOOR_PROXY_URL ?? process.env.NINE_ROUTER_PROXY_URL
  );
}
function readNoProxy() {
  return (
    process.env.DURINDOOR_PROXY_NO_PROXY ?? process.env.NINE_ROUTER_NO_PROXY
  );
}

export function applyOutboundProxyEnv(
  { outboundProxyEnabled, outboundProxyUrl, outboundNoProxy } = {}
) {
  if (typeof process === "undefined" || !process.env) return;
  const enabled = Boolean(outboundProxyEnabled);
  const proxyUrl = normalizeString(outboundProxyUrl);
  const noProxy = normalizeString(outboundNoProxy);

  // If disabled, only clear env vars we previously managed.
  if (!enabled) {
    if (readProxyManaged() === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.DURINDOOR_PROXY_MANAGED;
      delete process.env.DURINDOOR_PROXY_URL;
      delete process.env.DURINDOOR_PROXY_NO_PROXY;
    }
    return;
  }

  // When enabled:
  // - If values are provided, write them and mark as managed
  // - If values are empty, do not touch externally-provided env,
  //   but do clear values we previously managed.
  const wasManaged = readProxyManaged() === "1";
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.DURINDOOR_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.DURINDOOR_PROXY_NO_PROXY;
    }
  }

  if (proxyUrl) {
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.ALL_PROXY = proxyUrl;
    process.env.DURINDOOR_PROXY_URL = proxyUrl;
    managed = true;
  }

  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    process.env.DURINDOOR_PROXY_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.DURINDOOR_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    // If we previously managed env but now cleared everything, drop the marker.
    delete process.env.DURINDOOR_PROXY_MANAGED;
  }
}
