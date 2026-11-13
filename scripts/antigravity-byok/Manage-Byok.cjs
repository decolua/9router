"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const { createRequire } = require("node:module");

const RPC = "/api/cli-tools/antigravity-mitm";
const OTHER_TOOLS = ["copilot", "kiro", "cursor"];
function publicStatus(value) {
  return { success: true, running: value.running === true, pid: Number.isSafeInteger(value.pid) ? value.pid : null,
    isAdmin: value.isAdmin === true, certTrusted: value.certTrusted === true,
    otherBridgesActive: OTHER_TOOLS.some(tool => value.dnsStatus?.[tool] === true) };
}
function selectKey(keys) {
  return keys.find(key => key && key.isActive !== false && key.access?.restricted === false && typeof key.key === "string" && key.key);
}
function inspectOffline(config) {
  const file = path.join(config.dataDir, "db", "data.sqlite");
  if (!fs.existsSync(file)) throw Error("PROVIDER_SETUP_REQUIRED");
  let database;
  try {
    let Database;
    try { Database = require("node:sqlite").DatabaseSync; } catch { /* Node 20 fallback */ }
    if (Database) database = new Database(file, { readOnly: true });
    else {
      const localRequire = createRequire(path.join(config.dataDir, "runtime", "package.json"));
      const BetterSqlite = localRequire("better-sqlite3");
      database = new BetterSqlite(file, { readonly: true, fileMustExist: true });
    }
    const row = database.prepare("SELECT data FROM settings WHERE id = 1").get();
    const settings = row ? JSON.parse(row.data) : {};
    if (OTHER_TOOLS.some(tool => settings.dnsToolEnabled?.[tool] === true)) throw Error("OTHER_BRIDGES_CONFIGURED");
    return { success: true, otherBridgesConfigured: false };
  } catch (error) {
    if (error.message === "OTHER_BRIDGES_CONFIGURED") throw error;
    throw Error("OFFLINE_SETTINGS_UNAVAILABLE");
  } finally { database?.close(); }
}
function createManager(config, { fetchImpl = globalThis.fetch } = {}) {
  const base = `http://127.0.0.1:${config.gatewayPort}`;
  async function request(endpoint, method = "GET", body) {
    const machine = fs.readFileSync(path.join(config.dataDir, "machine-id"), "utf8").trim();
    const secret = fs.readFileSync(path.join(config.dataDir, "auth", "cli-secret"), "utf8").trim();
    if (!machine || !secret) throw Error("LOCAL_AUTH_UNAVAILABLE");
    const token = crypto.createHash("sha256").update(machine + "9r-cli-auth" + secret).digest("hex").slice(0, 16);
    const response = await fetchImpl(base + endpoint, { method,
      headers: { "x-9r-cli-token": token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(method === "GET" ? 5000 : 30000) });
    if (!response.ok) throw Error("LOCAL_API_FAILED");
    const data = await response.json();
    if (!data || typeof data !== "object" || data.error) throw Error("LOCAL_API_FAILED");
    return data;
  }
  async function start() {
    let status = await request(RPC);
    if (OTHER_TOOLS.some(tool => status.dnsStatus?.[tool] === true)) throw Error("OTHER_BRIDGES_ACTIVE");
    // Trust must be established explicitly in 9Router before this helper runs.
    // The native start endpoint can otherwise install a CA automatically.
    if (status.certTrusted !== true) throw Error("CERTIFICATE_NOT_TRUSTED");
    // Only the caller's already verified MITM is stopped. This endpoint removes
    // all DNS, so refuse the operation when another bridge is active.
    if (status.running === true) {
      const stopped = await request(RPC, "DELETE", {});
      if (stopped.success !== true || stopped.running !== false) throw Error("MITM_STOP_FAILED");
    }
    const key = selectKey((await request("/api/keys")).keys || []);
    if (!key) throw Error("LOCAL_UNRESTRICTED_KEY_REQUIRED");
    const started = await request(RPC, "POST", { apiKey: key.key, mitmRouterBaseUrl: base });
    if (started.success !== true || started.running !== true) throw Error("MITM_START_FAILED");
    status = await request(RPC);
    if (!status.certTrusted) throw Error("CERTIFICATE_NOT_TRUSTED");
    return publicStatus(status);
  }
  async function health() {
    // Pin the local CA only for this loopback request, preserving hostname and
    // TLS verification. Never disable certificate checks globally.
    const ca = fs.readFileSync(path.join(config.dataDir, "mitm", "rootCA.crt"));
    return new Promise((resolve, reject) => {
      const req = https.get({ hostname: "127.0.0.1", servername: "daily-cloudcode-pa.googleapis.com", port: 443,
        path: "/_mitm_health", ca, rejectUnauthorized: true, timeout: 3000 }, response => {
        let text = "";
        response.on("data", chunk => { text += chunk; if (text.length > 8192) req.destroy(); });
        response.on("end", () => {
          try {
            const value = JSON.parse(text);
            if (response.statusCode !== 200) throw Error();
            resolve({ success: true, ok: value.ok === true, byok: value.byok === true, pid: value.pid,
              feature: value.feature, byokPolicyVersion: value.byokPolicyVersion });
          } catch { reject(Error("MITM_HEALTH_FAILED")); }
        });
      });
      req.on("timeout", () => req.destroy(Error("MITM_HEALTH_FAILED")));
      req.on("error", () => reject(Error("MITM_HEALTH_FAILED")));
    });
  }
  return { status: async () => publicStatus(await request(RPC)), start, health };
}
async function main(settingsPath, action) {
  const safeCodes = new Set(["PROVIDER_SETUP_REQUIRED", "OTHER_BRIDGES_CONFIGURED", "OFFLINE_SETTINGS_UNAVAILABLE", "OTHER_BRIDGES_ACTIVE", "LOCAL_AUTH_UNAVAILABLE", "LOCAL_API_FAILED", "LOCAL_UNRESTRICTED_KEY_REQUIRED", "MITM_STOP_FAILED", "MITM_START_FAILED", "CERTIFICATE_NOT_TRUSTED", "MITM_HEALTH_FAILED"]);
  try {
    const config = JSON.parse(fs.readFileSync(settingsPath, "utf8").replace(/^\uFEFF/, ""));
    if (action === "inspect") return inspectOffline(config);
    if (!["status", "start", "health"].includes(action)) return { success: false, error: "INVALID_ACTION" };
    return await createManager(config)[action]();
  } catch (error) { return { success: false, error: safeCodes.has(error.message) ? error.message : "MANAGEMENT_FAILED" }; }
}
if (require.main === module) main(process.argv[2], process.argv[3]).then(value => { process.stdout.write(JSON.stringify(value) + "\n"); if (!value.success) process.exitCode = 1; });
module.exports = { createManager, publicStatus, selectKey, main };
