function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
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
    if (process.env.NINE_ROUTER_PROXY_MANAGED === "1") {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_PROXY_MANAGED;
      delete process.env.NINE_ROUTER_PROXY_URL;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
    return;
  }

  // When enabled:
  // - If values are provided, write them and mark as managed
  // - If values are empty, do not touch externally-provided env,
  //   but do clear values we previously managed.
  const wasManaged = process.env.NINE_ROUTER_PROXY_MANAGED === "1";
  let managed = false;

  if (wasManaged) {
    if (!proxyUrl) {
      delete process.env.HTTP_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.ALL_PROXY;
      delete process.env.NINE_ROUTER_PROXY_URL;
    }
    if (!noProxy) {
      delete process.env.NO_PROXY;
      delete process.env.NINE_ROUTER_NO_PROXY;
    }
  }

  if (proxyUrl) {
    process.env.HTTP_PROXY = proxyUrl;
    process.env.HTTPS_PROXY = proxyUrl;
    process.env.ALL_PROXY = proxyUrl;
    process.env.NINE_ROUTER_PROXY_URL = proxyUrl;
    managed = true;
  }

  if (noProxy) {
    process.env.NO_PROXY = noProxy;
    process.env.NINE_ROUTER_NO_PROXY = noProxy;
    managed = true;
  }

  if (managed) {
    process.env.NINE_ROUTER_PROXY_MANAGED = "1";
  } else if (wasManaged) {
    // If we previously managed env but now cleared everything, drop the marker.
    delete process.env.NINE_ROUTER_PROXY_MANAGED;
  }
}
