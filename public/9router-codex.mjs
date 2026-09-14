#!/usr/bin/env node
// 9router Codex integration. No npm packages; Node.js 24.5+ on macOS.
// Native credentials are forwarded only to fixed OpenAI hosts and never saved.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import https from "node:https";
import * as zlib from "node:zlib";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";

const exec = promisify(execFile);
const PREFIX = "9router/";
const MAX_BODY = 64 * 1024 * 1024;
const OWNED = ["model_provider", "openai_base_url", "model_catalog_json"];
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function validateRouterUrl(value) {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, "") !== "/api/chatgpt/v1") {
    throw new Error("Use https://your-router/api/chatgpt/v1 (HTTP is allowed only on loopback).");
  }
  return url.href.replace(/\/$/, "");
}

// Scan TOML statements, keeping comments, multiline strings and tables intact.
// Only simple root-level scalar keys owned by this integration are changed.
export function rootSettings(text) {
  const found = {};
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  let offset = 0, quote = null, depth = 0, statement = null;
  for (const line of lines) {
    if (!quote && depth === 0) {
      if (/^\s*\[/.test(line)) break;
      const match = line.match(/^\s*(?:([\w-]+)|"([\w-]+)"|'([\w-]+)')\s*=/);
      statement = match ? { key: match[1] || match[2] || match[3], start: offset, valueStart: offset + match[0].length } : null;
    }
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (quote.includes('"') && c === "\\") { i++; continue; }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
      } else if (c === "#") break;
      else if (c === '"' || c === "'") {
        quote = line.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
        i += quote.length - 1;
      } else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
    }
    offset += line.length;
    if (!quote && depth === 0 && statement) {
      if (Object.hasOwn(found, statement.key)) throw new Error(`Duplicate root setting: ${statement.key}`);
      found[statement.key] = { ...statement, end: offset, raw: text.slice(statement.start, offset) };
      statement = null;
    }
  }
  if (quote || depth !== 0) throw new Error("Cannot safely parse root settings in config.toml.");
  return found;
}

function scalar(setting) {
  if (!setting) return null;
  const value = setting.raw.slice(setting.valueStart - setting.start).trim();
  const match = value.match(/^("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#[^\n]*)?$/);
  if (!match) throw new Error(`Expected a simple string for ${setting.key}.`);
  return match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1);
}

export function replaceRoot(text, updates) {
  const roots = rootSettings(text);
  const ranges = Object.keys(updates).flatMap(key => roots[key] ? [roots[key]] : []).sort((a, b) => b.start - a.start);
  for (const range of ranges) text = text.slice(0, range.start) + text.slice(range.end);
  // Inserting at the start guarantees that no key lands inside a TOML table.
  return Object.values(updates).filter(Boolean).map(line => line.endsWith("\n") ? line : `${line}\n`).join("") + text;
}

export function enableConfig(text, endpoint, catalog, nativeModels, previous = null) {
  const roots = rootSettings(text);
  const model = scalar(roots.model);
  if (previous?.active) assertOwnership(text, previous);
  const original = previous?.active ? previous.original : Object.fromEntries([...OWNED, "model"].map(key => [key, roots[key]?.raw || null]));
  const applied = {
    model_provider: 'model_provider = "openai"\n',
    openai_base_url: `openai_base_url = ${JSON.stringify(endpoint)}\n`,
    model_catalog_json: `model_catalog_json = ${JSON.stringify(catalog)}\n`,
  };
  const nativeDefault = nativeModels.find(m => m.visibility === "list")?.slug || nativeModels[0]?.slug;
  if (!nativeDefault) throw new Error("No native Codex models found. Open Codex with your subscription first.");
  if (model && !nativeModels.some(m => m.slug === model) && !model.startsWith(PREFIX)) {
    applied.model = `model = ${JSON.stringify(nativeDefault)}\n`;
  }
  return { text: replaceRoot(text, applied), original,
    applied: { ...(previous?.active ? previous.applied : {}), ...applied }, nativeDefault };
}

function assertOwnership(text, state) {
  const roots = rootSettings(text);
  for (const key of OWNED) {
    if (scalar(roots[key]) !== scalar(rootSettings(state.applied[key])[key])) {
      throw new Error(`${key} was changed by another app. Restore the 9router value before disabling, or restore this key manually from ${state.directory}/state.json.`);
    }
  }
}

export function disableConfig(text, state) {
  assertOwnership(text, state);
  const updates = Object.fromEntries(OWNED.map(key => [key, state.original[key]]));
  const roots = rootSettings(text);
  const model = scalar(roots.model);
  if (model?.startsWith(PREFIX) || (state.applied.model && model === scalar(rootSettings(state.applied.model).model))) {
    updates.model = state.original.model || `model = ${JSON.stringify(state.nativeDefault)}\n`;
  }
  return replaceRoot(text, updates);
}

export function mergeCatalog(nativeModels, manifest) {
  const native = nativeModels.filter(model => typeof model.slug === "string" && !model.slug.startsWith(PREFIX));
  if (!native.length) throw new Error("The native Codex catalog is empty.");
  const baseInstructions = native.find(m => m.base_instructions)?.base_instructions ||
    "You are Codex, a coding agent. You and the user share a workspace and collaborate to achieve the user's goals. Use the available tools to complete the task.";
  const minPriority = Math.min(0, ...native.map(m => Number(m.priority) || 0));
  const additions = manifest.models.map((model, index) => ({
    slug: model.slug, display_name: model.slug, description: "9router model",
    default_reasoning_level: model.defaultReasoningLevel || null,
    supported_reasoning_levels: (model.reasoningLevels || []).map(effort => ({
      effort, description: effort === "none" ? "Disable reasoning where supported" : `${effort} reasoning supported by the selected 9router route`,
    })),
    shell_type: "unified_exec", visibility: "list", supported_in_api: true,
    priority: minPriority - manifest.models.length + index,
    additional_speed_tiers: [], service_tiers: [], default_service_tier: null,
    availability_nux: null, upgrade: null,
    base_instructions: baseInstructions, model_messages: null,
    include_skills_usage_instructions: true, include_plugin_usage_instructions: true,
    include_apps_usage_instructions: true, supports_reasoning_summary_parameter: false,
    supports_reasoning_summaries: false, default_reasoning_summary: "auto",
    support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
    web_search_tool_type: "text", truncation_policy: { mode: "tokens", limit: 10000 },
    supports_parallel_tool_calls: true, supports_image_detail_original: false,
    context_window: model.contextWindow, max_context_window: model.contextWindow,
    auto_compact_token_limit: null, effective_context_window_percent: 95,
    experimental_supported_tools: [], input_modalities: model.imageInput ? ["text", "image"] : ["text"],
    supports_search_tool: false,
  }));
  return { models: [...additions, ...native] };
}

export function validateManifest(data) {
  const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  if (data?.version !== 1 || !Array.isArray(data.models) || data.models.length > 5 ||
      data.models.some(m => !m || typeof m.id !== "string" || !m.id || m.slug !== PREFIX + m.id ||
        !Number.isFinite(m.contextWindow) || m.contextWindow < 4096 || m.contextWindow > 10000000 ||
        (m.reasoningLevels !== undefined && (!Array.isArray(m.reasoningLevels) ||
          m.reasoningLevels.length > levels.length || new Set(m.reasoningLevels).size !== m.reasoningLevels.length ||
          m.reasoningLevels.some(level => !levels.includes(level)))) ||
        (m.defaultReasoningLevel != null && !m.reasoningLevels?.includes(m.defaultReasoningLevel))) ||
      new Set(data.models.map(m => m.slug)).size !== data.models.length) {
    throw new Error("Invalid 9router model catalog.");
  }
  return data;
}

async function atomicWrite(filename, data) {
  const temporary = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.writeFile(temporary, data, { mode: 0o600, flag: "wx" });
  try { await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function readJson(filename) { return JSON.parse(await fs.readFile(filename, "utf8")); }
async function optionalJson(filename) {
  try { return await readJson(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function readConfig(filename) {
  try { return await fs.readFile(filename, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function nativeCatalog(codexHome) {
  const cached = await optionalJson(path.join(codexHome, "models_cache.json"));
  if (cached?.models?.some(m => m.visibility === "list" && !m.slug.startsWith(PREFIX))) return cached.models.filter(m => !m.slug.startsWith(PREFIX));
  for (const executable of ["/Applications/Codex.app/Contents/Resources/codex", "codex"]) {
    try {
      const { stdout } = await exec(executable, ["debug", "models", "--bundled"], { timeout: 15000, maxBuffer: 16 * 1024 * 1024, cwd: os.tmpdir() });
      const data = JSON.parse(stdout);
      const models = Array.isArray(data) ? data : data.models;
      if (models?.length) return models;
    } catch { /* Older Codex versions may not have this command. */ }
  }
  throw new Error("Native model catalog unavailable. Update Codex, sign in normally, open its model picker, then retry.");
}

async function fetchManifest(state) {
  const target = new URL(`${state.routerUrl}/models`);
  const transport = target.protocol === "https:" ? https : http;
  const agent = new transport.Agent({ proxyEnv: state.proxyEnv || {} });
  try {
    return await new Promise((resolve, reject) => {
      const request = transport.get(target, { agent, headers: { authorization: `Bearer ${state.apiKey}` }, signal: AbortSignal.timeout(15000) }, async response => {
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`9router catalog returned HTTP ${response.statusCode}. Check the endpoint and API key.`)); return; }
        try {
          let size = 0; const chunks = [];
          for await (const chunk of response) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error("9router catalog is too large.");
            chunks.push(chunk);
          }
          resolve(validateManifest(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
        } catch (error) { reject(error); }
      });
      request.on("error", () => reject(new Error("Could not connect to the 9router catalog. Check the endpoint and proxy settings.")));
    });
  } finally { agent.destroy(); }
}

function proxyEnvironment(previous) {
  const entries = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]);
  return entries.length ? Object.fromEntries(entries) : previous?.proxyEnv || {};
}

function endpointFor(state) { return `http://127.0.0.1:${state.port}/${state.token}/v1`; }
async function syncCatalog(state) {
  const manifest = await fetchManifest(state);
  const native = await nativeCatalog(state.codexHome);
  await atomicWrite(path.join(state.directory, "catalog.json"), json(mergeCatalog(native, manifest)));
  await atomicWrite(path.join(state.directory, "models.json"), json(manifest));
  return manifest;
}

const HOP_HEADERS = new Set(["host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-length"]);
export function routeHeaders(incoming, external, apiKey) {
  if (external) return { "content-type": "application/json", accept: "text/event-stream, application/json", authorization: `Bearer ${apiKey}` };
  const result = {};
  const connectionHeaders = String(incoming.connection || "").toLowerCase().split(",").map(s => s.trim());
  for (const [key, value] of Object.entries(incoming)) {
    if (!HOP_HEADERS.has(key.toLowerCase()) && !connectionHeaders.includes(key.toLowerCase()) &&
        !["cookie", "origin", "referer"].includes(key.toLowerCase()) && !key.toLowerCase().startsWith("x-9r-")) result[key] = value;
  }
  return result;
}

export async function decodeBody(raw, encoding) {
  if (!encoding || encoding === "identity") return raw;
  const decode = { gzip: zlib.gunzip, deflate: zlib.inflate, br: zlib.brotliDecompress, zstd: zlib.zstdDecompress }[encoding];
  if (!decode) throw new Error(`Unsupported Content-Encoding: ${encoding}`);
  return promisify(decode)(raw, { maxOutputLength: MAX_BODY });
}

function sendError(response, status, message) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ error: { message } }));
}

// Native traffic deliberately uses http(s).request: it neither follows redirects
// nor decompresses responses. SSE and response headers arrive byte-for-byte.
export function createBridge(state, options = {}) {
  const agents = { "http:": new http.Agent({ proxyEnv: state.proxyEnv || {} }), "https:": new https.Agent({ proxyEnv: state.proxyEnv || {} }) };
  const requestUpstream = options.requestUpstream || ((url, init, callback) =>
    (url.protocol === "https:" ? https : http).request(url, { ...init, agent: agents[url.protocol] }, callback));
  const getManifest = options.getManifest || (() => readJson(path.join(state.directory, "models.json")));
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      if (request.headers.origin || !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(request.socket.remoteAddress) ||
          !["127.0.0.1", "localhost"].some(h => host === `${h}:${server.address().port}`)) {
        return sendError(response, 403, "Loopback clients only.");
      }
      const prefix = `/${state.token}/v1`;
      const url = new URL(request.url, "http://127.0.0.1");
      const suffix = url.pathname.slice(prefix.length);
      if (!url.pathname.startsWith(`${prefix}/`)) return sendError(response, 404, "Not found.");
      if (suffix === "/_health" && request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return response.end(JSON.stringify({ ok: true, integration: "9router-codex", version: 1 }));
      }
      const inference = request.method === "POST" && ["/responses", "/responses/compact"].includes(suffix);
      // Codex also uses native auxiliary endpoints (for example hosted tools).
      // Only inference with a namespaced model can reach the remote router.
      if (!["GET", "POST"].includes(request.method)) return sendError(response, 405, "Unsupported Codex method.");
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY) return sendError(response, 413, "Request exceeds 64 MiB.");
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      let decoded, body;
      try {
        decoded = inference ? await decodeBody(raw, request.headers["content-encoding"]) : raw;
        body = inference ? JSON.parse(decoded.toString("utf8")) : null;
      } catch { return sendError(response, 400, "Invalid or unsupported request body."); }
      if (inference && typeof body?.model !== "string") return sendError(response, 400, "Model is required.");
      const external = body?.model.startsWith(PREFIX) === true;
      if (external) {
        const manifest = validateManifest(await getManifest());
        if (!manifest.models.some(model => model.slug === body.model)) return sendError(response, 404, "Model is not enabled. Sync the catalog and restart Codex.");
      } else if (!request.headers.authorization) {
        return sendError(response, 401, "Sign in to Codex with ChatGPT or an OpenAI API key.");
      }
      const base = external ? state.routerUrl : request.headers["chatgpt-account-id"]
        ? "https://chatgpt.com/backend-api/codex" : "https://api.openai.com/v1";
      const target = new URL(`${base}${suffix}${external ? "" : url.search}`);
      const forwarded = routeHeaders(request.headers, external, state.apiKey);
      const payload = external ? decoded : raw;
      // Router requests use uncompressed JSON; native requests retain encoding.
      if (request.method === "POST" || payload.length) forwarded["content-length"] = String(payload.length);
      const upstream = requestUpstream(target, { method: request.method, headers: forwarded }, async upstreamResponse => {
        const safeHeaders = {};
        for (const [key, value] of Object.entries(upstreamResponse.headers)) if (!HOP_HEADERS.has(key) && key !== "set-cookie") safeHeaders[key] = value;
        response.writeHead(upstreamResponse.statusCode, { ...safeHeaders, "x-accel-buffering": "no" });
        try { await pipeline(upstreamResponse, response); }
        catch { response.destroy(); }
      });
      response.on("close", () => upstream.destroy());
      upstream.on("error", () => {
        if (!response.headersSent) sendError(response, 502, "Upstream connection failed.");
        else response.destroy();
      });
      // Bound header wait, but allow long running streams and tool workflows.
      const timer = setTimeout(() => upstream.destroy(new Error("Upstream header timeout")), 120000);
      upstream.once("response", () => clearTimeout(timer));
      upstream.once("close", () => clearTimeout(timer));
      upstream.end(payload.length ? payload : undefined);
    } catch {
      if (!response.headersSent) sendError(response, 503, "Integration unavailable. Run the sync or disable command.");
      else response.destroy();
    }
  });
  // Codex retries HTTP after 426. No persistent WebSocket may pin the wrong model route.
  server.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  });
  server.on("close", () => { agents["http:"].destroy(); agents["https:"].destroy(); });
  return server;
}

function xml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function launchLabel(codexHome) { return `org.9router.codex.${createHash("sha256").update(codexHome).digest("hex").slice(0, 12)}`; }
export async function stopService(state, { run = exec, wait = delay } = {}) {
  const target = `gui/${process.getuid()}/${state.label}`;
  const registered = () => run("/bin/launchctl", ["print", target]).then(() => true, () => false);
  try { await run("/bin/launchctl", ["bootout", target]); }
  catch (error) {
    // Only absence is safe to ignore. A running service must not be orphaned.
    if (await registered()) throw new Error("Could not stop the 9router launch agent.");
    return;
  }
  // bootout can return before launchd removes the registration. Bootstrapping
  // the same label during that interval fails with error 5 on a running helper.
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!await registered()) return;
    await wait(100);
  }
  throw new Error("The previous 9router launch agent is still stopping. Retry enable shortly.");
}
async function startService(state) {
  await stopService(state);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xml(state.label)}</string><key>ProgramArguments</key><array>${[process.execPath, path.join(state.directory, "bridge.mjs"), "serve", "--codex-home", state.codexHome].map(arg => `<string>${xml(arg)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(path.join(state.directory, "bridge.log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(state.directory, "bridge.log"))}</string></dict></plist>\n`;
  await fs.mkdir(path.dirname(state.plist), { recursive: true });
  await atomicWrite(state.plist, plist);
  await exec("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, state.plist]);
}
async function health(state) {
  return new Promise(resolve => {
    // A health check must stay local even if the parent Node process uses a proxy.
    const request = http.get(`${endpointFor(state)}/_health`, { agent: false, signal: AbortSignal.timeout(1000) }, async response => {
      try {
        const chunks = []; let size = 0;
        for await (const chunk of response) {
          size += chunk.length;
          if (size > 4096) throw new Error("Invalid health response");
          chunks.push(chunk);
        }
        resolve(response.statusCode === 200 && JSON.parse(Buffer.concat(chunks).toString()).integration === "9router-codex");
      } catch { resolve(false); }
    });
    request.on("error", () => resolve(false));
  });
}

// Roll back every managed artifact if startup or the final config write fails.
// Kept separate from CLI parsing so failure recovery can be exercised without
// installing a launch agent on the test machine.
export async function activateIntegration(state, previous, configPath, originalText, nextText, artifacts, services = {}) {
  const start = services.start || startService;
  const stop = services.stop || stopService;
  const ready = services.ready || health;
  const snapshots = new Map();
  for (const [filename] of artifacts) {
    try { snapshots.set(filename, await fs.readFile(filename)); }
    catch (error) { if (error.code !== "ENOENT") throw error; snapshots.set(filename, null); }
  }
  let serviceTouched = false;
  try {
    for (const [filename, content] of artifacts) await atomicWrite(filename, content);
    serviceTouched = true;
    await start(state);
    let running = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await ready(state)) { running = true; break; }
      await delay(200);
    }
    if (!running) throw new Error("Local bridge did not start. Check the port or bridge.log.");
    if (await readConfig(configPath) !== originalText) throw new Error("Codex settings changed during setup. Retry enable.");
    await atomicWrite(configPath, nextText);
  } catch (error) {
    if (serviceTouched) await stop(state);
    for (const [filename, content] of snapshots) {
      if (content === null) await fs.rm(filename, { force: true });
      else await atomicWrite(filename, content);
    }
    if (serviceTouched) {
      if (previous?.active) await start(previous);
      else await fs.rm(state.plist, { force: true });
    }
    throw error;
  }
}

export async function deactivateIntegration(state, configPath, statePath, services = {}) {
  const stop = services.stop || stopService;
  const start = services.start || startService;
  const original = await readConfig(configPath);
  const restored = disableConfig(original, state);
  // If stopping is denied, leave config and state together so disable is retryable.
  await stop(state);
  let configWritten = false;
  try {
    if (await readConfig(configPath) !== original) throw new Error("Codex settings changed during disable. Retry after resolving the conflict.");
    await atomicWrite(configPath, restored);
    configWritten = true;
    await fs.rm(state.plist, { force: true });
    await atomicWrite(statePath, json({ ...state, active: false, apiKey: undefined }));
  } catch (error) {
    if (configWritten && await readConfig(configPath) === restored) await atomicWrite(configPath, original);
    await atomicWrite(statePath, json(state));
    await start(state);
    throw error;
  }
}

async function secretKey() {
  if (!process.stdin.isTTY) throw new Error("Set ROUTER9_API_KEY or run in a terminal to enter a 9router API key.");
  process.stdout.write("Copy a 9router key from Dashboard > Endpoint & Key. Paste it below and press Enter.\nThe input is hidden; no characters or asterisks will appear.\n");
  process.stdout.write("9router API key (hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const listener = data => {
      for (const c of data.toString()) {
        if (c === "\r" || c === "\n" || c === "\u0003") {
          process.stdin.off("data", listener);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          if (c === "\u0003") reject(new Error("Canceled."));
          else if (!value.trim()) reject(new Error("API key is required."));
          else resolve(value.trim());
          return;
        }
        if (c === "\u007f") value = value.slice(0, -1);
        else if (c >= " ") value += c;
      }
    };
    process.stdin.on("data", listener);
  });
}

export async function resolveApiKey(previous, routerUrl, { env = process.env, prompt = secretKey, ask = false } = {}) {
  if (!ask && env.ROUTER9_API_KEY?.trim()) return { apiKey: env.ROUTER9_API_KEY.trim(), source: "ROUTER9_API_KEY" };
  if (!ask && previous?.routerUrl === routerUrl && previous?.apiKey) return { apiKey: previous.apiKey, source: "saved helper settings" };
  return { apiKey: await prompt(), source: "terminal prompt" };
}

async function runMain(args) {
  const command = args[0] || "help";
  const arg = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  if (command === "help" || command === "--help") {
    console.log("9router Codex integration (macOS, Node.js 24.5+)\n\n  enable --url https://your-router/api/chatgpt/v1 [--port 20130]\n  sync       Refresh models, then restart Codex\n  status     Check the local bridge\n  disable    Restore previous settings and stop the bridge\n\nOptional: --codex-home /path/to/.codex\n  enable --ask-api-key  Enter a different key even when one is already saved\nThe API key is read from ROUTER9_API_KEY or a hidden terminal prompt.");
    return;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!zlib.zstdDecompress || major < 24 || (major === 24 && minor < 5)) throw new Error("Node.js 24.5+ is required for Codex zstd requests and proxy support.");
  if (!["enable", "disable", "sync", "status", "serve"].includes(command)) throw new Error("Unknown command. Use --help.");
  const codexHome = path.resolve(arg("--codex-home") || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const directory = path.join(codexHome, "9router-chatgpt");
  const statePath = path.join(directory, "state.json");
  const configPath = path.join(codexHome, "config.toml");
  const previous = await optionalJson(statePath);
  if (command === "status") {
    if (previous?.active) assertOwnership(await readConfig(configPath), previous);
    console.log(!previous?.active ? "Disabled" : await health(previous) ? `Running: ${endpointFor(previous)}` : "Enabled, but the bridge is not running. Re-run enable or disable.");
    return;
  }
  if (command === "serve") {
    if (!previous?.active) throw new Error("Integration is disabled.");
    const server = createBridge(previous);
    server.on("error", () => { console.error("Cannot start bridge; check the configured port."); process.exitCode = 1; });
    server.listen(previous.port, "127.0.0.1");
    return;
  }
  if (command === "sync") {
    if (!previous?.active) throw new Error("Enable the integration first.");
    assertOwnership(await readConfig(configPath), previous);
    const manifest = await syncCatalog(previous);
    console.log(`Synced ${manifest.models.length} router models. Restart Codex to refresh its model picker.`);
    return;
  }
  if (process.platform !== "darwin") throw new Error("Automatic installation currently supports macOS only.");
  if (command === "disable") {
    if (!previous?.active) { console.log("Already disabled."); return; }
    await deactivateIntegration(previous, configPath, statePath);
    console.log("Disabled. Previous routing settings restored; auth.json was untouched. Restart Codex.");
    return;
  }
  const routerUrl = validateRouterUrl(arg("--url") || previous?.routerUrl || "");
  const port = Number(arg("--port") || previous?.port || 20130);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Port must be between 1024 and 65535.");
  const { apiKey, source: keySource } = await resolveApiKey(previous, routerUrl, { ask: args.includes("--ask-api-key") });
  console.log(`Using API key from ${keySource}.`);
  const label = launchLabel(codexHome);
  const state = { active: true, codexHome, directory, routerUrl, apiKey, port, label, proxyEnv: proxyEnvironment(previous),
    token: previous?.token || randomBytes(24).toString("hex"),
    plist: path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`) };
  const manifest = await fetchManifest(state);
  const native = await nativeCatalog(codexHome);
  const text = await readConfig(configPath);
  const config = enableConfig(text, endpointFor(state), path.join(directory, "catalog.json"), native, previous);
  Object.assign(state, { original: config.original, applied: config.applied, nativeDefault: config.nativeDefault });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const artifacts = [
    [path.join(directory, "bridge.mjs"), await fs.readFile(fileURLToPath(import.meta.url))],
    [path.join(directory, "catalog.json"), json(mergeCatalog(native, manifest))],
    [path.join(directory, "models.json"), json(manifest)],
    [statePath, json(state)],
  ];
  // Retain the original full backup through repeated enables.
  if (!previous?.active) artifacts.push([path.join(directory, "config-before-enable.toml"), text]);
  await activateIntegration(state, previous, configPath, text, config.text, artifacts);
  console.log(`Enabled: ${manifest.models.length} router models alongside native Codex models.\nRestart Codex. Native requests go directly to OpenAI.\nLocal endpoint: ${endpointFor(state)}\nHelper: ${path.join(directory, "bridge.mjs")}\nDisable: node <helper-path> disable --codex-home <codex-home>`);
}

export async function main(args) {
  if (!["enable", "disable", "sync"].includes(args[0])) return runMain(args);
  const index = args.indexOf("--codex-home");
  const codexHome = path.resolve((index >= 0 ? args[index + 1] : undefined) || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const directory = path.join(codexHome, "9router-chatgpt");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, "operation.lock");
  let lock;
  try { lock = await fs.open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Another setup operation may be running. If none is running, remove ${lockPath} and retry.`);
  }
  try { return await runMain(args); }
  finally { await lock.close(); await fs.rm(lockPath, { force: true }); }
}

if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => "") === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
