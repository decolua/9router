/**
 * Token Swap Pool — reads providerConnections from db.json,
 * provides round-robin rotation with cooldown management.
 *
 * Runs in MITM server process (CJS, separate from Next.js).
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { DATA_DIR } = require("./paths");
const { log } = require("./logger");

const DB_FILE = path.join(DATA_DIR, "db.json");
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5min before expiry
const ROUTER_PORT = process.env.PORT || 20128;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

// ── In-memory state ──────────────────────────────────────────
const cooldownMap = {};   // { [connectionId]: expiresTimestamp }
const rrState = {};       // { [provider]: roundRobinIndex }

// ── Cooldown management ──────────────────────────────────────

function setCooldown(connId, durationMs) {
  const ms = durationMs || DEFAULT_COOLDOWN_MS;
  cooldownMap[connId] = Date.now() + ms;
  log(`⏸ [token-pool] cooldown: ${connId.slice(0, 8)}… for ${Math.ceil(ms / 60000)}m`);
}

function isInCooldown(connId) {
  if (!cooldownMap[connId]) return false;
  if (Date.now() > cooldownMap[connId]) {
    delete cooldownMap[connId];
    return false;
  }
  return true;
}

// ── Quota cooldown parser ────────────────────────────────────
// Antigravity error format: "Your quota will reset after 2h7m23s"
function parseQuotaCooldown(errorBody) {
  try {
    const json = JSON.parse(errorBody);
    const msg = json?.error?.message || json?.message || "";
    const match = msg.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;
    let ms = 0;
    if (match[1]) ms += parseInt(match[1]) * 3600000;
    if (match[2]) ms += parseInt(match[2]) * 60000;
    if (match[3]) ms += parseInt(match[3]) * 1000;
    return ms > 0 ? ms : null;
  } catch { return null; }
}

// ── Read connections from db.json (sync) ─────────────────────

function getActiveConnections(provider) {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    const connections = db.providerConnections || [];
    const now = Date.now();

    return connections
      .filter(c =>
        c.provider === provider &&
        c.isActive !== false &&
        c.accessToken &&
        !isInCooldown(c.id) &&
        // Skip expired tokens that have no refresh token
        !(c.expiresAt && new Date(c.expiresAt).getTime() < now && !c.refreshToken)
      )
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));
  } catch { return []; }
}

function isTokenSwapEnabled(provider) {
  try {
    if (!fs.existsSync(DB_FILE)) return false;
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    // Explicit toggle — must be enabled in settings
    if (!db.settings?.tokenSwapEnabled) {
      return false;
    }
    const active = getActiveConnections(provider);
    if (active.length === 0) {
      log(`⚙️ [token-pool] swap enabled in settings but no active ${provider} connections`);
      return false;
    }
    return true;
  } catch { return false; }
}

function getNextConnection(provider) {
  const connections = getActiveConnections(provider);
  if (connections.length === 0) return null;
  if (connections.length === 1) {
    log(`🎯 [token-pool] selected: "${connections[0].name || connections[0].email || connections[0].id.slice(0, 8)}" (only account)`);
    return connections[0];
  }
  const idx = (rrState[provider] || 0) % connections.length;
  rrState[provider] = idx + 1;
  const selected = connections[idx];
  log(`🎯 [token-pool] round-robin[${idx}/${connections.length}]: "${selected.name || selected.email || selected.id.slice(0, 8)}"`);
  return selected;
}

function getAllActiveConnections(provider) {
  return getActiveConnections(provider);
}

// ── Token refresh trigger (fire-and-forget via HTTP) ─────────
// Calls 9Router's existing POST /api/providers/:id/test which
// checks expiry and refreshes token automatically.

function triggerRefreshIfNeeded(connection) {
  if (!connection.expiresAt) return;
  const expiresAt = new Date(connection.expiresAt).getTime();
  if (Date.now() + TOKEN_EXPIRY_BUFFER_MS < expiresAt) return;

  log(`🔄 [token-pool] near-expiry refresh → ${(connection.name || connection.email || connection.id).slice(0, 20)}`);
  try {
    const req = http.request(
      { hostname: "127.0.0.1", port: ROUTER_PORT, path: `/api/providers/${connection.id}/test`, method: "POST" },
      () => {} // ignore response
    );
    req.on("error", () => {}); // swallow
    req.end();
  } catch { /* ignore */ }
}

module.exports = {
  isTokenSwapEnabled,
  getNextConnection,
  getAllActiveConnections,
  triggerRefreshIfNeeded,
  setCooldown,
  parseQuotaCooldown,
};
