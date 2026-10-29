import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";
import { OPENCODE_TRANSPORT_CONFIG } from "../config/runtimeConfig.js";

const HTTP_PROXY_RE = /^https?:\/\//i;
const SOCKS_PROXY_RE = /^socks(4a?|5h?)?:\/\//i;
const TRANSPORT_PATH = "/forward";
const SIDECAR = path.join("scripts", "opencode-transport.mjs");

let active = null;
let starting = null;
let retryAt = 0;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isSupportedProxyUrl(proxyUrl) {
  return HTTP_PROXY_RE.test(proxyUrl) || SOCKS_PROXY_RE.test(proxyUrl);
}

function available() {
  return OPENCODE_TRANSPORT_CONFIG.mode !== "off" && Date.now() >= retryAt;
}

function sidecarPath() {
  return normalizeString(process.env.OPENCODE_TRANSPORT_SCRIPT) || path.join(process.cwd(), SIDECAR);
}

function block(error) {
  retryAt = Date.now() + OPENCODE_TRANSPORT_CONFIG.failureBackoffMs;
  console.warn(`[OpenCodeTransport] ${error.message}`);
  stop();
}

function stop() {
  const child = active?.child;
  active = null;
  starting = null;
  if (child) {
    try { child.kill("SIGKILL"); } catch { }
  }
}

function start() {
  if (starting) return starting;
  retryAt = 0;
  starting = new Promise((resolve, reject) => {
    const token = randomBytes(24).toString("hex");
    const child = spawn(OPENCODE_TRANSPORT_CONFIG.bunBin, [sidecarPath()], {
      cwd: process.cwd(),
      env: { ...process.env, OPENCODE_TRANSPORT_TOKEN: token, OPENCODE_TRANSPORT_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let output = "";
    let stderr = "";
    const timer = setTimeout(() => finish(new Error("sidecar did not report ready")), OPENCODE_TRANSPORT_CONFIG.readyTimeoutMs);

    function finish(error, port) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        starting = null;
        try { child.kill("SIGKILL"); } catch { }
        block(error);
        reject(error);
        return;
      }
      active = { child, port, token };
      starting = null;
      resolve(active);
    }

    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/READY (\d+)/);
      if (match) finish(null, Number(match[1]));
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.on("error", (error) => finish(new Error(`spawn failed: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (!settled) finish(new Error(`sidecar exited (${code ?? signal}) ${stderr}`.trim()));
      else if (active?.child === child) active = null;
    });
  });
  return starting;
}

async function ensure() {
  if (!available()) return null;
  if (active) return active;
  try {
    return await start();
  } catch {
    return null;
  }
}

function headerObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === "function" && !Array.isArray(headers)) {
    return Object.fromEntries(headers.entries());
  }
  return { ...headers };
}

function forward(port, token, payload, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: TRANSPORT_PATH,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-transport-token": token,
      },
    }, (response) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
        else if (value != null) headers.set(key, value);
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 502,
        statusText: response.statusMessage || "",
        headers,
      }));
    });
    request.on("error", reject);
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error("aborted"));
        return;
      }
      signal.addEventListener("abort", () => request.destroy(new Error("aborted")), { once: true });
    }
    request.end(body);
  });
}

export async function fetchViaTransport(url, options = {}, { proxyUrl = "", signal } = {}) {
  if (!available()) return null;
  if (typeof options.body !== "string" || !options.body) return null;

  const target = typeof url === "string" ? url : url.toString();
  const proxy = normalizeString(proxyUrl);
  if (proxy && !isSupportedProxyUrl(proxy)) return null;

  const transport = await ensure();
  if (!transport) return null;

  try {
    const response = await forward(transport.port, transport.token, {
      url: target,
      method: options.method || "POST",
      headers: headerObject(options.headers),
      body: options.body,
      proxy: proxy || null,
    }, signal);
    if (response.headers.get("x-transport-error") === "1") {
      try { await response.body?.cancel(); } catch { }
      return null;
    }
    return response;
  } catch (error) {
    if (signal?.aborted || error.name === "AbortError") return null;
    block(new Error(`forward failed: ${error.message}`));
    return null;
  }
}

export function resetTransport() {
  stop();
  retryAt = 0;
}
