/**
 * HTTP/2 client sessions, optionally tunneled through an HTTP CONNECT or SOCKS proxy.
 *
 * Node's http2.connect() is a direct TCP/TLS connection and ignores HTTP_PROXY.
 * Cursor's AgentService (GetUsableModels) is HTTP/2-only, so we must keep h2
 * and tunnel it: CONNECT (or SOCKS) → TLS(ALPN=h2) → http2 session.
 */

import net from "net";
import tls from "tls";
import http2 from "http2";

const DEFAULT_TIMEOUT_MS = 15_000;
const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

export function isSocksProxyUrl(proxyUrl) {
  try {
    return SOCKS_PROTOCOLS.has(new URL(proxyUrl).protocol);
  } catch {
    return false;
  }
}

export function buildHttpConnectRequest(targetHost, targetPort, proxyUrl) {
  const proxy = new URL(proxyUrl);
  let auth = "";
  if (proxy.username || proxy.password) {
    const user = decodeURIComponent(proxy.username || "");
    const pass = decodeURIComponent(proxy.password || "");
    auth = `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}\r\n`;
  }
  return (
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
    `Host: ${targetHost}:${targetPort}\r\n` +
    auth +
    `\r\n`
  );
}

async function connectViaHttpProxy(proxyUrl, targetHost, targetPort, timeoutMs) {
  const proxy = new URL(proxyUrl);
  const proxyPort = Number(proxy.port) || (proxy.protocol === "https:" ? 443 : 80);

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.hostname, port: proxyPort });
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    socket.once("error", fail);
    socket.once("timeout", () => fail(new Error("Proxy CONNECT timed out")));
    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      socket.write(buildHttpConnectRequest(targetHost, targetPort, proxyUrl));
    });

    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString("latin1");
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      socket.off("data", onData);
      const statusLine = buf.slice(0, buf.indexOf("\r\n"));
      const code = Number(statusLine.split(" ")[1]);
      if (code !== 200) {
        fail(new Error(`Proxy CONNECT failed: ${statusLine.trim()}`));
        return;
      }
      const leftover = buf.slice(headerEnd + 4);
      if (leftover.length) socket.unshift(Buffer.from(leftover, "latin1"));
      settled = true;
      socket.setTimeout(0);
      socket.removeListener("error", fail);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}

async function connectViaSocks(proxyUrl, targetHost, targetPort, timeoutMs) {
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const agent = new SocksProxyAgent(proxyUrl, { timeout: timeoutMs });
  const req = {
    protocol: "http:",
    host: targetHost,
    port: Number(targetPort),
    path: `${targetHost}:${targetPort}`,
    method: "CONNECT",
  };
  const opts = {
    host: targetHost,
    port: Number(targetPort),
    secureEndpoint: false,
  };
  if (typeof agent.connect !== "function") {
    throw new Error("SOCKS agent does not expose connect()");
  }
  const socket = agent.connect(req, opts);
  return socket && typeof socket.then === "function" ? await socket : socket;
}

async function createProxiedTlsSocket(proxyUrl, targetHost, targetPort, timeoutMs) {
  const plain = isSocksProxyUrl(proxyUrl)
    ? await connectViaSocks(proxyUrl, targetHost, targetPort, timeoutMs)
    : await connectViaHttpProxy(proxyUrl, targetHost, targetPort, timeoutMs);

  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket: plain,
      servername: targetHost,
      ALPNProtocols: ["h2"],
    });
    const timer = setTimeout(() => {
      tlsSocket.destroy();
      reject(new Error("TLS handshake through proxy timed out"));
    }, timeoutMs);
    tlsSocket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Open an HTTP/2 client session to `url`.
 * When `proxyUrl` is set (http://, https://, socks5://, …), tunnel via CONNECT/SOCKS.
 */
export async function connectHttp2(url, { proxyUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const urlObj = new URL(url);
  const host = urlObj.hostname;
  const port = Number(urlObj.port) || 443;
  const authority = `https://${host}${urlObj.port ? `:${urlObj.port}` : ""}`;

  if (!proxyUrl) {
    return http2.connect(authority);
  }

  const tlsSocket = await createProxiedTlsSocket(proxyUrl, host, port, timeoutMs);
  return http2.connect(authority, {
    createConnection: () => tlsSocket,
  });
}
