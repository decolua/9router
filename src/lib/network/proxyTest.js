import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Parse proxy URL from various formats
 * Supports:
 * - ip:port
 * - ip:port:user:pass
 * - user:pass@ip:port
 * - protocol://ip:port
 * - protocol://user:pass@ip:port
 * - protocol://ip:port:user:pass
 */
function parseProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  // Handle protocol:// prefix
  let urlStr = normalizedInput;
  if (urlStr.includes("://")) {
    urlStr = urlStr.split("://")[1];
  }

  // Handle user:pass@ip:port format
  let username = null;
  let password = null;
  let hostPort = urlStr;

  if (urlStr.includes("@")) {
    const [authPart, hostPortPart] = urlStr.split("@");
    hostPort = hostPortPart;

    if (authPart.includes(":")) {
      [username, password] = authPart.split(":");
    } else {
      username = authPart;
    }
  }

  // Handle ip:port:user:pass format (no @)
  if (hostPort.includes(":") && !hostPort.startsWith("http")) {
    const parts = hostPort.split(":");
    if (parts.length === 4) {
      // ip:port:user:pass format
      [hostPort, username, password] = parts;
    } else if (parts.length === 3) {
      // ip:port:user format (user without password)
      [hostPort, username] = parts;
    }
  }

  // Parse host and port
  let host = "";
  let port = "";
  let protocol = "http"; // default

  if (hostPort.includes("/")) {
    // Handle path-like formats
    const url = new URL(`http://${hostPort}`);
    host = url.hostname;
    port = url.port;
    protocol = url.protocol.replace(":", "");
  } else if (hostPort.includes(":")) {
    [host, port] = hostPort.split(":");
  } else {
    host = hostPort;
    port = "";
  }

  // Validate host
  if (!host || host === "") {
    return null;
  }

  // Build proxy URL
  let parsedProxyUrl = "";
  if (protocol) {
    parsedProxyUrl += `${protocol}://`;
  }

  if (username) {
    if (password) {
      parsedProxyUrl += `${username}:${password}@`;
    } else {
      parsedProxyUrl += `${username}@`;
    }
  }

  parsedProxyUrl += host;

  if (port) {
    parsedProxyUrl += `:${port}`;
  }

  return parsedProxyUrl;
}

/**
 * Parse multiple proxy URLs from a string (bulk import)
 * Supports comma-separated list
 */
function parseProxyUrls(proxyUrls) {
  if (!proxyUrls) return [];

  const urls = normalizeString(proxyUrls).split(",");
  const parsedUrls = [];

  for (const url of urls) {
    const parsed = parseProxyUrl(url.trim());
    if (parsed) {
      parsedUrls.push(parsed);
    }
  }

  return parsedUrls;
}

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs } = {}) {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  // Parse proxy URL from various formats
  const parsedProxyUrl = parseProxyUrl(normalizedProxyUrl);
  if (!parsedProxyUrl) {
    return { ok: false, status: 400, error: "Invalid proxy URL format" };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    try {
      dispatcher = new ProxyAgent({ uri: parsedProxyUrl });
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${err?.message || String(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "9Router",
        },
      });

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}

/**
 * Test multiple proxy URLs in bulk
 * Supports comma-separated list or array of proxy URLs in various formats
 */
export async function testProxyUrls({ proxyUrls, testUrl, timeoutMs } = {}) {
  if (!proxyUrls) {
    return [];
  }

  const urls = Array.isArray(proxyUrls) ? proxyUrls : parseProxyUrls(proxyUrls);
  const results = [];

  for (const url of urls) {
    const result = await testProxyUrl({ proxyUrl: url, testUrl, timeoutMs });
    results.push({ proxyUrl: url, ...result });
  }

  return results;
}
