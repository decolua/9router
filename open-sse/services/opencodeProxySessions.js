// Proxy-pinned free-tier session identities (2026-10-29).
//
// Upstream's free gate reads a request as a CLI user: a stable residential
// egress IP carrying a stable x-opencode-session for a long-lived
// conversation. Issuing a brand-new session id on every request (the
// SESSION_FRESH experiment) reads as identity churn — bursts of never-seen
// sessions that exhaust the 30x5s retry budget (~150s per failed request)
// and surface 429 FreeUsageLimitError to the client. Model instead: each
// connection-pool proxy OWNS one pinned session id. It is reused for every
// request egressing through that proxy and rotated only when upstream burns
// it. Minting is local (valid ses_ timestamp format), so rotation never
// blocks on an upstream round-trip.
//
// Env:
//   OPENCODE_PROXY_PIN=0          kill switch (pinning on by default)
//   OPENCODE_PROXY_SESSION_FILE   state path (default ~/.9router/oc-proxy-sessions.json)
//   OPENCODE_PROXY_PIN_DEBUG=1    log REUSE lines (default logs only MINT/BURN)
//
// State is keyed by a SHA-256 prefix of the proxy URL — no proxy
// credentials are ever persisted to disk.

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const PIN_DISABLED = process.env.OPENCODE_PROXY_PIN === "0" || process.env.OPENCODE_PROXY_PIN === "false";
const PIN_DEBUG = process.env.OPENCODE_PROXY_PIN_DEBUG === "1";
const STATE_FILE = process.env.OPENCODE_PROXY_SESSION_FILE
  || path.join(os.homedir(), ".9router", "oc-proxy-sessions.json");
const MAX_ENTRIES = 4096;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 2000;
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const entries = new Map();      // proxyHash -> { s, m, u, b, bd }
const sessionIndex = new Map(); // sessionId -> proxyHash
let sessionIdFactory = null;
let persistTimer = null;
let loaded = false;
let persistBroken = false;

function proxyHashOf(proxyUrl) {
  return crypto.createHash("sha256").update(String(proxyUrl)).digest("hex").slice(0, 12);
}

function fallbackSessionId() {
  const time = Date.now().toString(16).padStart(12, "0");
  let rand = "";
  for (let i = 0; i < 14; i++) rand += B62[Math.floor(Math.random() * B62.length)];
  return `ses_${time}${rand}`;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const now = Date.now();
    for (const [hash, e] of Object.entries(raw?.entries || {})) {
      if (!e || typeof e !== "object") continue;
      if (now - Math.max(e.m || 0, e.u || 0) > RETENTION_MS) continue;
      entries.set(hash, { s: e.s || null, m: e.m || 0, u: e.u || 0, b: e.b || 0, bd: e.bd || 0 });
      if (e.s) sessionIndex.set(e.s, hash);
    }
  } catch {
    // missing or corrupt state: start empty; first mints repopulate it
  }
  const cleanup = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [hash, e] of entries) {
      if (now - Math.max(e.m, e.u) <= RETENTION_MS) continue;
      if (e.s) sessionIndex.delete(e.s);
      entries.delete(hash);
      changed = true;
    }
    if (changed) schedulePersist();
  }, 30 * 60 * 1000);
  if (cleanup.unref) cleanup.unref();
}

function schedulePersist() {
  if (PIN_DISABLED || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const out = { version: 1, savedAt: new Date().toISOString(), entries: {} };
      for (const [hash, e] of entries) out.entries[hash] = e;
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, STATE_FILE);
      try { fs.chmodSync(STATE_FILE, 0o600); } catch { }
      persistBroken = false;
    } catch {
      if (!persistBroken) {
        persistBroken = true;
        console.log(`[OC-PIN] WARN cannot persist state to ${STATE_FILE}`);
      }
    }
  }, PERSIST_DEBOUNCE_MS);
  if (persistTimer.unref) persistTimer.unref();
}

export function initProxySessionStore({ sessionIdFactory: factory } = {}) {
  if (typeof factory === "function") sessionIdFactory = factory;
  load();
}

// Stable session for this egress identity. Returns null when pinning is off
// or the request does not egress through a connection proxy (legacy paths).
export function pinnedSessionForProxy(proxyUrl) {
  if (PIN_DISABLED || !proxyUrl) return null;
  load();
  const hash = proxyHashOf(proxyUrl);
  const now = Date.now();
  const entry = entries.get(hash);
  if (entry && entry.s) {
    entry.u = now;
    if (PIN_DEBUG) console.log(`[OC-PIN] REUSE proxy=${hash} session=${entry.s} burns=${entry.b}`);
    return entry.s;
  }
  const session = (sessionIdFactory || fallbackSessionId)();
  const fresh = entry || { s: null, m: 0, u: now, b: 0, bd: 0 };
  fresh.s = session;
  fresh.m = now;
  fresh.u = now;
  entries.set(hash, fresh);
  sessionIndex.set(session, hash);
  console.log(`[OC-PIN] MINT proxy=${hash} burns=${fresh.b} session=${session}`);
  if (entries.size > MAX_ENTRIES) {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [h, e] of entries) {
      const at = Math.max(e.m, e.u);
      if (at < oldestAt) { oldestAt = at; oldestKey = h; }
    }
    if (oldestKey && oldestKey !== hash) {
      const dead = entries.get(oldestKey);
      if (dead && dead.s) sessionIndex.delete(dead.s);
      entries.delete(oldestKey);
    }
  }
  schedulePersist();
  return session;
}

// Upstream rejected the session (FreeUsageLimitError): drop it so the next
// request through the owning proxy mints a fresh identity. One rotation per
// exhausted request — the retry loop's intermediate attempts do not churn.
export function burnSessionId(sessionId) {
  if (PIN_DISABLED || !sessionId) return false;
  load();
  const hash = sessionIndex.get(sessionId);
  if (!hash) return false;
  sessionIndex.delete(sessionId);
  const entry = entries.get(hash);
  if (!entry) return false;
  entry.s = null;
  entry.b += 1;
  entry.bd = Date.now();
  console.log(`[OC-PIN] BURN proxy=${hash} burns=${entry.b} session=${sessionId}`);
  schedulePersist();
  return true;
}
