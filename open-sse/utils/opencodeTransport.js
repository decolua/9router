import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { OPENCODE_TRANSPORT_CONFIG } from "../config/runtimeConfig.js";
import { normalizeString, resolveEffectiveProxyUrl } from "./proxyResolution.js";

const TRANSPORT_PATH = "/forward";
const SIDECAR = path.join("scripts", "opencode-transport.mjs");

let active = null;
let starting = null;
let retryAt = 0;

function available() {
  return OPENCODE_TRANSPORT_CONFIG.mode !== "off" && Date.now() >= retryAt;
}

function sidecarPath() {
  const configured = normalizeString(process.env.OPENCODE_TRANSPORT_SCRIPT);
  if (configured) return configured;
  // The CLI starts custom-server.js with the caller's cwd, so scripts/ is not
  // necessarily under process.cwd(). Probe the app root relative to this file
  // too: open-sse/utils/ -> <app>/scripts/opencode-transport.mjs.
  let base = "";
  try {
    base = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  } catch {
    base = "";
  }
  const candidates = [path.join(process.cwd(), SIDECAR)];
  if (base) candidates.push(path.join(base, "..", "..", SIDECAR));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { }
  }
  return candidates[0];
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

/**
 * Resolve the Bun executable.
 *
 * spawn() works on POSIX and on Windows installs that ship bun.exe on PATH,
 * but the npm shim installs `bun.cmd` (a shell wrapper) while the real binary
 * sits at node_modules/bun/bin/bun.exe. spawn() cannot execute a .cmd and does
 * not resolve it through PATH on Windows, so prefer the exe the shim points at.
 *
 * @returns {string} binary path or name for spawn()
 */
function bunBinary() {
  const configured = normalizeString(process.env.OPENCODE_BUN_BIN);
  if (configured) return configured;

  // The 9router CLI starts custom-server.js with the caller's cwd, not the app
  // directory, and a bare "bun" fails with ENOENT on Windows (spawn does not
  // execute .cmd shims). Enumerate the real install layouts instead: the npm
  // global prefix that owns the running node binary, %APPDATA%/npm, and the
  // usual standalone Bun installs.
  const roots = [];
  const push = (value) => {
    const dir = normalizeString(value);
    if (dir) roots.push(dir);
  };
  const nodeDir = path.dirname(process.execPath);
  push(process.cwd());
  push(nodeDir);
  // D:\Environment\nodejs\node.exe -> D:\Environment (the npm prefix root)
  push(path.join(nodeDir, ".."));
  push(path.join(nodeDir, "..", "node_global"));
  push(process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "");
  push(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "bun") : "");
  push(process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".bun", "bin") : "");

  const candidates = [];
  for (const root of roots) {
    candidates.push(path.join(root, "bun.exe"));
    candidates.push(path.join(root, "node_modules", "bun", "bin", "bun.exe"));
    candidates.push(path.join(root, "bun", "bun.exe"));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { }
  }

  return OPENCODE_TRANSPORT_CONFIG.bunBin || "bun";
}
function start() {
  if (starting) return starting;
  retryAt = 0;
  starting = new Promise((resolve, reject) => {
    const token = randomBytes(24).toString("hex");
    const child = spawn(bunBinary(), [sidecarPath()], {
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

export async function fetchViaTransport(url, options = {}, proxyOptions = null) {
  if (!available()) return null;
  if (normalizeString(proxyOptions?.vercelRelayUrl)) return null;
  if (typeof options.body !== "string" || !options.body) return null;

  const target = typeof url === "string" ? url : url.toString();
  const { url: proxyUrl } = resolveEffectiveProxyUrl(target, proxyOptions);
  if (proxyUrl && !/^https?:\/\//i.test(proxyUrl)) return null;

  const transport = await ensure();
  if (!transport) return null;

  try {
    const response = await forward(transport.port, transport.token, {
      url: target,
      method: options.method || "POST",
      headers: headerObject(options.headers),
      body: options.body,
      proxy: proxyUrl || null,
    }, options.signal);
    if (response.headers.get("x-transport-error") === "1") {
      try { await response.body?.cancel(); } catch { }
      return null;
    }
    return response;
  } catch (error) {
    if (options.signal?.aborted || error.name === "AbortError") return null;
    block(new Error(`forward failed: ${error.message}`));
    return null;
  }
}

export function resetTransport() {
  stop();
  retryAt = 0;
}
