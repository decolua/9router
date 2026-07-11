import { connect as tlsConnect } from "node:tls";
import { Agent, ProxyAgent } from "undici";
import { SocksClient } from "socks";

const HTTPS_PORT = 443;
const SUPPORTED_PROXY_SCHEMES = new Set(["http:", "https:", "socks5:", "socks5h:", "socks4:", "socks4a:"]);
export const SOCKS_PROXY_SCHEMES = new Set(["socks5:", "socks5h:", "socks4:", "socks4a:"]);

export function normalizeProxyUrl(proxyUrl) {
  const value = proxyUrl === undefined || proxyUrl === null ? "" : String(proxyUrl).trim();
  if (!value) return null;
  const normalized = value.includes("://") ? value : `http://${value}`;
  const parsed = new URL(normalized);
  if (!SUPPORTED_PROXY_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function isSocksProxyUrl(proxyUrl) {
  try {
    return SOCKS_PROXY_SCHEMES.has(new URL(proxyUrl).protocol);
  } catch {
    return false;
  }
}

export function createSocksConnector(proxyUrl) {
  const proxy = new URL(proxyUrl);
  const type = proxy.protocol.startsWith("socks4") ? 4 : 5;
  const proxyPort = Number(proxy.port || 1080);
  const proxyAuth = proxy.username
    ? { userId: decodeURIComponent(proxy.username), password: decodeURIComponent(proxy.password || "") }
    : undefined;

  return async function socksConnect(options, callback) {
    try {
      const protocol = options.protocol || "https:";
      const hostname = options.hostname;
      const destPort = Number(options.port || (protocol === "https:" ? HTTPS_PORT : 80));
      const { socket } = await SocksClient.createConnection({
        proxy: { host: proxy.hostname, port: proxyPort, type, ...(proxyAuth || {}) },
        command: "connect",
        destination: { host: hostname, port: destPort },
      });
      if (protocol !== "https:") {
        callback(null, socket);
        return;
      }
      const tlsSocket = tlsConnect({
        socket,
        servername: options.servername || hostname,
        rejectUnauthorized: true,
        ALPNProtocols: ["http/1.1"],
      });
      tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
      tlsSocket.once("error", (error) => callback(error, null));
    } catch (error) {
      callback(error, null);
    }
  };
}

export async function createProxyDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;
  return isSocksProxyUrl(normalized)
    ? new Agent({ connect: createSocksConnector(normalized) })
    : new ProxyAgent({ uri: normalized });
}

export function disposeProxyDispatcher(dispatcher) {
  if (!dispatcher || typeof dispatcher !== "object") return;
  try {
    const result = typeof dispatcher.destroy === "function"
      ? dispatcher.destroy()
      : dispatcher.close?.();
    Promise.resolve(result).catch(() => {});
  } catch {
    // Best-effort disposal must not block request handling.
  }
}
