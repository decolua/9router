import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

const token = process.env.OPENCODE_TRANSPORT_TOKEN || "";
const port = Number(process.env.OPENCODE_TRANSPORT_PORT || 0);

const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);

function isSocksProxyUrl(proxyUrl) {
  const value = String(proxyUrl || "").trim();
  if (!value) return false;
  try {
    return SOCKS_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function parseSocksProxyUrl(proxyUrl) {
  const parsed = new URL(String(proxyUrl).trim());
  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  const proxyPort = Number(parsed.port);

  return {
    version: protocol.startsWith("socks4") ? 4 : 5,
    remoteDns: protocol === "socks5h" || protocol === "socks4a",
    host: parsed.hostname.replace(/^\[/, "").replace(/\]$/, ""),
    port: Number.isFinite(proxyPort) && proxyPort > 0 ? proxyPort : 1080,
    username: parsed.username ? decodeURIComponent(parsed.username) : "",
    password: parsed.password ? decodeURIComponent(parsed.password) : "",
  };
}

function connectSocket(host, socketPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPort, host);
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
    return Buffer.from([0x01, ...host.split(".").map((part) => Number(part))]);
  }
  if (net.isIPv6(host)) {
    return Buffer.concat([Buffer.from([0x04]), ipv6ToBuffer(host)]);
  }
  const encoded = Buffer.from(host, "utf8");
  return Buffer.concat([Buffer.from([0x03, encoded.length]), encoded]);
}

async function connectSocks5(options, host, targetPort) {
  const socket = await connectSocket(options.host, options.port);
  const state = { buffer: Buffer.alloc(0) };

  try {
    const methods = options.username ? [0x00, 0x02] : [0x00];
    await writeAll(socket, Buffer.from([0x05, methods.length, ...methods]));

    const greeting = await readExact(socket, 2, state);
    if (greeting[0] !== 0x05) throw new Error("SOCKS5 proxy returned an invalid greeting");
    if (greeting[1] === 0xff) throw new Error("SOCKS5 proxy rejected every authentication method");

    if (greeting[1] === 0x02) {
      const user = Buffer.from(options.username, "utf8");
      const pass = Buffer.from(options.password, "utf8");
      await writeAll(socket, Buffer.concat([
        Buffer.from([0x01, user.length]), user,
        Buffer.from([pass.length]), pass,
      ]));
      const auth = await readExact(socket, 2, state);
      if (auth[1] !== 0x00) throw new Error("SOCKS5 proxy rejected the credentials");
    } else if (greeting[1] !== 0x00) {
      throw new Error(`SOCKS5 proxy selected an unsupported authentication method (${greeting[1]})`);
    }

    await writeAll(socket, Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00]),
      socks5Address(host),
      Buffer.from([targetPort >> 8, targetPort & 0xff]),
    ]));

    const reply = await readExact(socket, 4, state);
    if (reply[1] !== 0x00) throw new Error(`SOCKS5 proxy refused the connection (code ${reply[1]})`);

    if (reply[3] === 0x01) {
      await readExact(socket, 6, state);
    } else if (reply[3] === 0x04) {
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

async function connectSocks4(options, host, targetPort) {
  const socket = await connectSocket(options.host, options.port);
  const state = { buffer: Buffer.alloc(0) };

  try {
    const useRemoteName = options.remoteDns || !net.isIPv4(host);
    const address = useRemoteName
      ? Buffer.from([0x00, 0x00, 0x00, 0x01])
      : Buffer.from(host.split(".").map((part) => Number(part)));

    const request = [
      Buffer.from([0x04, 0x01, targetPort >> 8, targetPort & 0xff]),
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

function openSocksSocket(proxyUrl, host, targetPort) {
  const options = parseSocksProxyUrl(proxyUrl);
  return options.version === 4
    ? connectSocks4(options, host, targetPort)
    : connectSocks5(options, host, targetPort);
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({
      socket,
      servername: net.isIP(host) ? undefined : host,
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

async function socksFetch(target, options) {
  const parsed = new URL(target);
  const host = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  const targetPort = Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);

  const raw = await openSocksSocket(options.proxy, host, targetPort);
  const socket = parsed.protocol === "https:" ? await upgradeToTls(raw, host) : raw;

  const headers = { ...options.headers };
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "host")) headers.host = parsed.host;

  const body = options.body === undefined || options.body === null
    ? undefined
    : Buffer.from(String(options.body), "utf8");
  if (body) headers["content-length"] = String(body.length);

  const lib = parsed.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = lib.request(parsed, {
      method: options.method || "GET",
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
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function forwardableHeaders(input) {
  const headers = {};
  for (const [key, value] of Object.entries(input || {})) {
    const name = key.toLowerCase();
    if (name === "host" || name === "content-length" || name === "connection") continue;
    if (name === "accept-encoding" || name === "transfer-encoding") continue;
    if (value == null) continue;
    headers[key] = String(value);
  }
  return headers;
}

function responseHeaders(input) {
  const headers = new Headers();
  input.forEach((value, key) => {
    const name = key.toLowerCase();
    if (name === "content-encoding" || name === "content-length") return;
    if (name === "transfer-encoding" || name === "connection") return;
    headers.set(key, value);
  });
  return headers;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname !== "/forward" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }
    if (token && request.headers.get("x-transport-token") !== token) {
      return new Response("forbidden", { status: 403 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }
    if (!payload?.url) return new Response("bad request", { status: 400 });

    const options = {
      method: payload.method || "POST",
      headers: forwardableHeaders(payload.headers),
      body: payload.body ?? undefined,
      proxy: payload.proxy || null,
    };
    options.headers["accept-encoding"] = "identity";

    let upstream;
    try {
      upstream = payload.proxy && isSocksProxyUrl(payload.proxy)
        ? await socksFetch(payload.url, options)
        : await fetch(payload.url, {
          ...options,
          redirect: "manual",
          ...(payload.proxy ? { proxy: payload.proxy } : {}),
        });
    } catch (error) {
      return Response.json(
        { error: String(error?.message || error) },
        { status: 502, headers: { "x-transport-error": "1" } }
      );
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers),
    });
  },
});

console.log(`READY ${server.port}`);
