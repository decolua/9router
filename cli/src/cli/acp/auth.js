/**
 * Credential handling for the ACP agent.
 *
 * Precedence: --api-key / --url  >  NINE_ROUTER_API_KEY / NINE_ROUTER_URL  >
 * ~/.9router/acp-config.json (0600).
 *
 * The key never goes into an editor settings file and never into stdout: an
 * editor's agent_servers config is plaintext on disk, which is why Zed's own
 * docs say to keep keys out of settings.json.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const SECRET_MODE = 0o600;
const DEFAULT_URL = process.env.NINE_ROUTER_URL || "http://127.0.0.1:20128";

// Resolved per call so DATA_DIR can be redirected at runtime (tests, portable
// installs) instead of freezing the process environment at require time.
const configFile = () => path.join(process.env.DATA_DIR || path.join(os.homedir(), ".9router"), "acp-config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8")) || {};
  } catch {
    return {};
  }
}

function storeCredentials({ baseUrl, apiKey }) {
  const file = configFile();
  const cur = readConfig();
  const next = { ...cur };
  if (baseUrl) next.baseUrl = baseUrl;
  if (apiKey) next.apiKey = apiKey;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { mode: SECRET_MODE });
  try {
    fs.chmodSync(file, SECRET_MODE);
  } catch {
    /* Windows */
  }
  return file;
}

function clearCredentials() {
  const file = configFile();
  const cur = readConfig();
  if (!cur.apiKey && !cur.baseUrl) return false;
  delete cur.apiKey;
  delete cur.baseUrl;
  try {
    fs.writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`, { mode: SECRET_MODE });
  } catch {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  return true;
}

function resolveCredentials(opts = {}) {
  const file = readConfig();
  const baseUrl = (opts.url || process.env.NINE_ROUTER_URL || file.baseUrl || DEFAULT_URL).replace(/\/+$/, "");
  const apiKey = opts.apiKey || process.env.NINE_ROUTER_API_KEY || file.apiKey || null;
  return {
    baseUrl,
    apiKey,
    source: opts.apiKey || process.env.NINE_ROUTER_API_KEY ? "flag/env" : file.apiKey ? "file" : "none",
  };
}

function hasStoredKey() {
  return Boolean(resolveCredentials({}).apiKey);
}

module.exports = {
  configFile,
  DEFAULT_URL,
  readConfig,
  storeCredentials,
  clearCredentials,
  resolveCredentials,
  hasStoredKey,
};
