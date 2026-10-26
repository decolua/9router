import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

const SOCKS5_VERSION = 0x05;
const SOCKS4_VERSION = 0x04;
const CMD_CONNECT = 0x01;
const ATYP_IPV4 = 0x01;
const ATYP_DOMAIN = 0x03;
const ATYP_IPV6 = 0x04;
const AUTH_NONE = 0x00;
const AUTH_USERPASS = 0x02;
const DEFAULT_SOCKS_PORT = 1080;

export const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

export function isSocksProxyUrl(proxyUrl) {
  const value = String(proxyUrl || "").trim();
  if (!value) return false;
  try {
    return SOCKS_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function parseSocksProxyUrl(proxyUrl) {
  const parsed = new URL(String(proxyUrl).trim());
  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  const port = Number(parsed.port);

  return {
    protocol,
    version: protocol.startsWith("socks4") ? 4 : 5,
    remoteDns: protocol === "socks5h" || protocol === "socks4a",
    host: parsed.hostname.replace(/^\[/, "").replace(/\]$/, ""),
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_SOCKS_PORT,
    username: parsed.username ? decodeURIComponent(parsed.username) : "",
    password: parsed.password ? decodeURIComponent(parsed.password) : "",
  };
}

function connectSocket(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    const onError = (error) => {
      socket.off("connect", onConnect);
      socket.destroy();
      reject(error);
    };
    const onConnect = () => {
      socket.off("error", onError);
      resolve(socket);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function readExact(socket, size, state) {
  return new Promise((resolve, reject) => {
    if (state.buffer.length >= size) {
      const value = state.buffer.subarray(0, size);
      state.buffer = state.buffer.subarray(size);
      resolve(value);
      return;
    }

    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      if (state.buffer.length < size) return;
      cleanup();
      const value = state.buffer.subarray(0, size);
      state.buffer = state.buffer.subarray(size);
      resolve(value);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("SOCKS proxy closed the connection"));
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

function writeAll(socket, buffer) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off("error", onError);
      reject(error);
    };
    socket.once("error", onError);
    socket.write(buffer, () => {
      socket.off("error", onError);
      resolve();
    });
  });
}

function ipv6ToBuffer(address) {
  const [head, tail = ""] = address.split("::");
  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail ? tail.split(":").filter(Boolean) : [];
  const middle = new Array(Math.max(0, 8 - left.length - right.length)).fill("0");
  const buffer = Buffer.alloc(16);
  [...left, ...middle, ...right].forEach((group, index) => {
    buffer.writeUInt16BE(parseInt(group || "0", 16) || 0, index * 2);
  });
  return buffer;
}

function socks5Address(host) {
  if (net.isIPv4(host)) {
    return Buffer.from([ATYP_IPV4, ...host.split(".").map((part) => Number(part))]);
  }
  if (net.isIPv6(host)) {
    return Buffer.concat([Buffer.from([ATYP_IPV6]), ipv6ToBuffer(host)]);
  }
  const encoded = Buffer.from(host, "utf8");
  return Buffer.concat([Buffer.from([ATYP_DOMAIN, encoded.length]), encoded]);
}

async function connectSocks5(options, host, port) {
  const socket = await connectSocket(options.host, options.port);
  const state = { buffer: Buffer.alloc(0) };

  try {
    const methods = options.username ? [AUTH_NONE, AUTH_USERPASS] : [AUTH_NONE];
    await writeAll(socket, Buffer.from([SOCKS5_VERSION, methods.length, ...methods]));

    const greeting = await readExact(socket, 2, state);
    if (greeting[0] !== SOCKS5_VERSION) throw new Error("SOCKS5 proxy returned an invalid greeting");
    if (greeting[1] === 0xff) throw new Error("SOCKS5 proxy rejected every authentication method");

    if (greeting[1] === AUTH_USERPASS) {
      const user = Buffer.from(options.username, "utf8");
      const pass = Buffer.from(options.password, "utf8");
      await writeAll(socket, Buffer.concat([
        Buffer.from([0x01, user.length]), user,
        Buffer.from([pass.length]), pass,
      ]));
      const auth = await readExact(socket, 2, state);
      if (auth[1] !== 0x00) throw new Error("SOCKS5 proxy rejected the credentials");
    } else if (greeting[1] !== AUTH_NONE) {
      throw new Error(`SOCKS5 proxy selected an unsupported authentication method (${greeting[1]})`);
    }

    await writeAll(socket, Buffer.concat([
      Buffer.from([SOCKS5_VERSION, CMD_CONNECT, 0x00]),
      socks5Address(host),
      Buffer.from([port >> 8, port & 0xff]),
    ]));

    const reply = await readExact(socket, 4, state);
    if (reply[1] !== 0x00) throw new Error(`SOCKS5 proxy refused the connection (code ${reply[1]})`);

    if (reply[3] === ATYP_IPV4) {
      await readExact(socket, 6, state);
    } else if (reply[3] === ATYP_IPV6) {
      await readExact(socket, 18, state);
    } else {
      const length = await readExact(socket, 1, state);
      await readExact(socket, length[0] + 2, state);
    }

    if (state.buffer.length) socket.unshift(state.buffer);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function connectSocks4(options, host, port) {
  const socket = await connectSocket(options.host, options.port);
  const state = { buffer: Buffer.alloc(0) };

  try {
    const useRemoteName = options.remoteDns || !net.isIPv4(host);
    const address = useRemoteName
      ? Buffer.from([0x00, 0x00, 0x00, 0x01])
      : Buffer.from(host.split(".").map((part) => Number(part)));

    const request = [
      Buffer.from([SOCKS4_VERSION, CMD_CONNECT, port >> 8, port & 0xff]),
      address,
      Buffer.from(options.username || "", "utf8"),
      Buffer.from([0x00]),
    ];
    if (useRemoteName) request.push(Buffer.from(host, "utf8"), Buffer.from([0x00]));

    await writeAll(socket, Buffer.concat(request));
    const reply = await readExact(socket, 8, state);
    if (reply[1] !== 0x5a) throw new Error(`SOCKS4 proxy refused the connection (code ${reply[1]})`);

    if (state.buffer.length) socket.unshift(state.buffer);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export function openSocksSocket(proxyUrl, host, port) {
  const options = parseSocksProxyUrl(proxyUrl);
  return options.version === 4
    ? connectSocks4(options, host, port)
    : connectSocks5(options, host, port);
}

function upgradeToTls(socket, host, tlsOptions = {}) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({
      socket,
      servername: tlsOptions.servername || (net.isIP(host) ? undefined : host),
      rejectUnauthorized: tlsOptions.rejectUnauthorized !== false,
      ca: tlsOptions.ca,
    });
    const onError = (error) => {
      secure.off("secureConnect", onSecure);
      secure.destroy();
      reject(error);
    };
    const onSecure = () => {
      secure.off("error", onError);
      resolve(secure);
    };
    secure.once("secureConnect", onSecure);
    secure.once("error", onError);
  });
}

function requestOverSocket(parsedUrl, init, socket) {
  const lib = parsedUrl.protocol === "https:" ? https : http;

  const headers = {};
  const source = init.headers;
  if (source instanceof Headers) {
    for (const [key, value] of source.entries()) headers[key] = value;
  } else if (source) {
    Object.assign(headers, source);
  }
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "host")) {
    headers.host = parsedUrl.host;
  }

  let body = init.body;
  if (body !== undefined && body !== null) {
    if (typeof body === "string") body = Buffer.from(body, "utf8");
    else if (body instanceof Uint8Array) body = Buffer.from(body);
    else if (body instanceof ArrayBuffer) body = Buffer.from(new Uint8Array(body));
    else throw new Error("SOCKS proxy transport supports string or binary bodies only");
    headers["content-length"] = String(body.length);
  }

  return new Promise((resolve, reject) => {
    const request = lib.request(parsedUrl, {
      method: init.method || "GET",
      headers,
      createConnection: () => socket,
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers || {})) {
        if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, String(item)));
        else if (value != null) responseHeaders.set(key, String(value));
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 502,
        statusText: response.statusMessage || "",
        headers: responseHeaders,
      }));
    });

    const signal = init.signal;
    if (signal) {
      const abort = () => request.destroy(new Error("aborted"));
      if (signal.aborted) {
        request.destroy(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export async function socksFetch(url, init = {}, proxyUrl, tlsOptions = {}) {
  const parsedUrl = new URL(typeof url === "string" ? url : url.toString());
  const host = parsedUrl.hostname.replace(/^\[/, "").replace(/\]$/, "");
  const port = Number(parsedUrl.port) || (parsedUrl.protocol === "https:" ? 443 : 80);

  const raw = await openSocksSocket(proxyUrl, host, port);
  const socket = parsedUrl.protocol === "https:"
    ? await upgradeToTls(raw, host, tlsOptions)
    : raw;

  return requestOverSocket(parsedUrl, init, socket);
}
