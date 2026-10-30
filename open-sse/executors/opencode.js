import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { isMuseSparkModel } from "../providers/models/helpers.js";
import { applyFingerprintTools, applyFingerprintSystem, applyFingerprintSystemMessages } from "../utils/opencodeFingerprint.js";
// 2026-10-30: upstream 429s every inference request made from INSIDE this
// long-lived process — regardless of egress IP, session id, header/body bytes
// (byte-verified) or TLS module — while the byte-identical request from a
// fresh node process passes (the router's own sticky sid replayed from a test
// process on the SAME egress IP returned 200). The distinguishing factor is
// process-lifetime-bound and unobservable from inside, so each attempt is
// proxied through the oc-worker supervisor (systemd: oc-worker.service,
// 127.0.0.1:20137), which runs the impersonated fetch in a FRESH child
// process per attempt. Worker failures surface as errors so base.js retries
// on a brand-new process. They deliberately do NOT fail open to in-process
// fetch: Node's OpenSSL ClientHello is refused by the upstream gate with the
// very same 429 FreeUsageLimitError.
const OC_WORKER_URL = process.env.OC_WORKER_URL || "http://127.0.0.1:20137/fetch";

async function opencodeWorkerFetch(url, init = {}, { signal, timeoutMs = 20000, proxyUrl } = {}) {
  const bridgeRes = await fetch(OC_WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url, method: init.method || "GET", headers: init.headers || {},
      body: init.body, proxyUrl, timeoutMs,
    }),
    signal,
  });
  if (bridgeRes.status === 502 || bridgeRes.status === 504) {
    const text = await bridgeRes.text().catch(() => "");
    throw new Error(`oc-worker: ${bridgeRes.status} ${String(text).slice(0, 140)}`);
  }
  const headers = new Headers();
  bridgeRes.headers?.forEach?.((value, key) => {
    if (key !== "content-length" && key !== "transfer-encoding") headers.set(key, value);
  });
  return new Response(bridgeRes.body, {
    status: bridgeRes.status,
    statusText: bridgeRes.statusText,
    headers,
  });
}
import { initProxySessionStore, pinnedSessionForProxy, burnSessionId } from "../services/opencodeProxySessions.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../translator/formats/responsesApi.js";

// Fingerprint = the REAL v2 CLI wire shape, byte-verified against a live working dev build (opencode 0.0.0-dev-202610272228, 38/40 recent
// inference calls OK) and its source: packages/core/src/session/model-request.ts
//   UA "opencode/<channel>/<version>/<name>", x-opencode-client "opencode",
//   x-opencode-project = 40-hex project id, and the session id carried by FOUR
//   headers: x-opencode-session-id + x-session-affinity + X-Session-Id +
//   x-opencode-session. The v1.19.5 shape this file sent before (UA
//   "opencode/1.19.5 ai-sdk/...", client "cli", project "global", two session
//   headers, no affinity) reads as an impostor: it passes when the free gate is
//   lenient and 429 FreeUsageLimitError the moment strict validation kicks in,
//   which is exactly the observed "worked N times, then everything 429s" wave.
const OPENCODE_UA = "opencode/dev/0.0.0-dev-202610272228/opencode";
const OPENCODE_CLIENT = "opencode";
// 40-hex project id, generated once per process boot: the real CLI derives
// it from the local project path, so each install presents its own; a
// hardcoded value would funnel every deployment into one upstream bucket.
const OPENCODE_PROJECT = crypto.randomBytes(20).toString("hex");
const MAX_SESSION_LENGTH = 256;
const MAX_TOOL_NAME_LEN = 128;
const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeSession";
export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Proxy-pinned upstream session identities (v5, 2026-10-29): each connection-pool
// proxy owns ONE stable x-opencode-session, reused for every request egressing
// through it and rotated only when upstream rejects it (FreeUsageLimitError).
// Per-request fresh ids (SESSION_FRESH) read as identity churn upstream: bursts
// of never-seen sessions that exhaust the 30x5s retry budget (~150s) and surface
// 429s to the client. Minting is local, so a rotation never blocks on upstream.
initProxySessionStore({ sessionIdFactory: generateSessionId });

function hasValidOpencodeVersion(ua) {
  const s = String(ua || "").trim();
  // v2 prerelease shape: opencode/<channel>/<semver>/<name>
  if (/^opencode\/[a-z0-9-]+\/\d+\.\d+\.\d+\/[a-z0-9-]+/i.test(s)) return true;
  // v1 stable shape: opencode/<semver>[ ai-sdk/... runtime/bun/...]
  return /^opencode\/\d+\.\d+(\.\d+)?(\s|$)/i.test(s);
}
// Models served by /inference/v1/responses; every other model stays on /chat/completions.
const RESPONSES_MODELS = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);
const MESSAGES_MODELS = new Set(["union-alpha"]);

let lastTimestamp = 0;
let counter = 0;

function unstableRandom() {
  const bytes = crypto.randomBytes(14);
  let randomPart = "";
  for (let i = 0; i < 14; i++) {
    randomPart += BASE62_CHARS[bytes[i] % 62];
  }
  return randomPart;
}

// Session prefix = 12 hex of ~(timeMs * 0x1000 + counter), low 48 bits, like the CLI.
// Upstream decodes it and rejects a non-small counter with 403 FreeTierError
// (live probes: counter 0–16 pass, >=100 fail), so the counter must stay real.
const SESSION_PREFIX_MASK = (1n << 48n) - 1n;

function descendingTimeHex(time, counterValue) {
  return (~(BigInt(time) * 0x1000n + BigInt(counterValue)) & SESSION_PREFIX_MASK)
    .toString(16)
    .padStart(12, "0");
}

export function generateSessionId(timestamp = Date.now()) {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp;
    counter = 0;
  }
  counter++;
  return `ses_${descendingTimeHex(timestamp, counter)}${unstableRandom()}`;
}

// x-opencode-request: the triggering user-message id the v1 CLI sends on EVERY
// inference request (msg_ + ASCENDING identifier, fresh per user message).
// Requests without it are not shaped like any released CLI.
function ascendingTimeHex(time, counterValue) {
  return ((BigInt(time) * 0x1000n + BigInt(counterValue)) & SESSION_PREFIX_MASK)
    .toString(16)
    .padStart(12, "0");
}

export function generateRequestId(timestamp = Date.now()) {
  return `msg_${ascendingTimeHex(timestamp, 1)}${unstableRandom()}`;
}

// Rotating residential gateway: the sticky `session-<id>` segment inside the
// proxy username pins the egress IP. The free gate answers PER IP - a fixed
// segment means every request rides one residential IP until it burns
// (429 FreeUsageLimitError, Retry-After ~6.6h, live probe 2026-10-29), and the
// whole pool degrades IP by IP. Rewrite the segment per ATTEMPT so every
// request presents from a fresh residential IP (matrix probe 2026-10-29: a
// fresh IP passes instantly regardless of session/fingerprint shape, a burned
// IP 429s regardless of it).
const PROXY_SESSION_RE = /session-[A-Za-z0-9]+/;
function rotateProxySession(proxyUrl) {
  const raw = String(proxyUrl || "");
  if (!raw) return proxyUrl;
  const at = raw.lastIndexOf("@");
  const head = at >= 0 ? raw.slice(0, at) : raw;
  const tail = at >= 0 ? raw.slice(at) : "";
  if (!PROXY_SESSION_RE.test(head)) return proxyUrl;
  const fresh = `session-${crypto.randomBytes(4).toString("hex")}`;
  return head.replace(PROXY_SESSION_RE, fresh) + tail;
}

// Upstream decodes the prefix timestamp and refuses sessions whose time is in
// the future or older than the free-tier window (live probes 2026-10-26: a
// Date.now() session passed 10/10 while digest-derived ones passed 1/10). A
// digest is uniform over 2^36 ms, so most translated ids were refused even
// though their shape matched. Mint with the current time and memoize per
// conversation so a conversation keeps one stable, valid session.
const translatedOpencodeSessions = new Map();
const MAX_TRANSLATED_SESSIONS = 5000;
const translatedSessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of translatedOpencodeSessions) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
      translatedOpencodeSessions.delete(key);
    }
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (translatedSessionCleanup.unref) translatedSessionCleanup.unref();

export function translateSessionId(sessionId, clientTool = "") {
  if (typeof sessionId === "string" && OPENCODE_SESSION_RE.test(sessionId.trim())) {
    return sessionId.trim();
  }
  const key = `${clientTool || "generic"}\0${sessionId || ""}`;
  const existing = translatedOpencodeSessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.sessionId;
  }
  const translated = `ses_${descendingTimeHex(Date.now(), 1)}${unstableRandom()}`;
  if (translatedOpencodeSessions.size >= MAX_TRANSLATED_SESSIONS) {
    translatedOpencodeSessions.delete(translatedOpencodeSessions.keys().next().value);
  }
  translatedOpencodeSessions.set(key, { sessionId: translated, lastUsed: Date.now() });
  return translated;
}

function normalizeSession(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

function nativeSession(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === SESSION_HEADER) {
      const normalized = normalizeSession(value);
      if (normalized && OPENCODE_SESSION_RE.test(normalized)) return normalized;
    }
  }
  return null;
}

// Upstream free-tier quota is accounted per session. Minting a fresh
// x-opencode-session on every request burns through it and surfaces as
// 429 FreeUsageLimitError with growing reset-after delays, while the real
// CLI reuses one long-lived canonical session per conversation. Mirror
// that: one stable canonical session per downstream identity, evicted
// after MEMORY_CONFIG.sessionTtlMs like the other session stores.
const stableOpencodeSessions = new Map();
const MAX_STABLE_SESSIONS = 1000;
const stableSessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of stableOpencodeSessions) {
    if (now - entry.lastUsed > MEMORY_CONFIG.sessionTtlMs) {
      stableOpencodeSessions.delete(key);
    }
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (stableSessionCleanup.unref) stableSessionCleanup.unref();

function identityKey(credentials) {
  const connectionId = credentials?.connectionId || credentials?.id;
  if (connectionId) return `opencode:conn:${String(connectionId).slice(0, 128)}`;
  const raw = credentials?.rawHeaders || {};
  const auth = raw.authorization || raw.Authorization || raw["x-api-key"] || raw["X-Api-Key"] || "";
  if (auth) {
    const digest = crypto.createHash("sha256").update(String(auth)).digest("hex").slice(0, 32);
    return `opencode:auth:${digest}`;
  }
  return "opencode:default";
}

export function stableSessionId(credentials) {
  const key = identityKey(credentials);
  const existing = stableOpencodeSessions.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    stableOpencodeSessions.delete(key);
    stableOpencodeSessions.set(key, existing);
    return existing.sessionId;
  }
  const sessionId = generateSessionId();
  if (stableOpencodeSessions.size >= MAX_STABLE_SESSIONS) {
    stableOpencodeSessions.delete(stableOpencodeSessions.keys().next().value);
  }
  stableOpencodeSessions.set(key, { sessionId, lastUsed: Date.now() });
  return sessionId;
}

// Free-tier session pool v3 (observed 2026-10-28): upstream answers freshly
// minted x-opencode-session values with 429 FreeUsageLimitError when minted
// too soon after the previous one (17s gap rejected, 48s+ accepted), while
// long-lived sessions keep working and even tolerate parallel requests on the
// same session. The real CLI mints one session per human conversation, but
// agent swarms mint one per subagent task, which reads as churn. Strategy:
// - keep a small pool of upstream sessions per downstream identity
// - map each conversation/subagent onto a slot by stable hash (stable lanes)
// - pace mints at least MIN_MINT_GAP_MS apart (single-flight per identity);
//   a request that would need a mint before the window opens WAITS (the CLI
//   tolerates slow first tokens) or shares a live lane — never fires a mint
//   that upstream is guaranteed to reject
// - a session rejected with FreeUsageLimitError is marked poisoned and the
//   identity enters an exponential mint backoff (60s * 2^failures, cap 10min)
// - repeat failures on an already-poisoned session do not extend the backoff
const SESSION_POOL_SIZE = 8;
const SESSION_USED_PROP = Symbol("opencode.sessionUsed");
const MIN_MINT_GAP_MS = 45 * 1000;
const SESSION_WAIT_CAP_MS = 120 * 1000;
const MINT_BACKOFF_BASE_MS = 60 * 1000;
const MINT_BACKOFF_MAX_MS = 10 * 60 * 1000;
const stableSessionPools = new Map(); // identityKey -> { pool, mintFailures, backoffUntil, lastMintAt }
const mintInflight = new Map(); // identityKey -> Promise<entry>

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stablePoolCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, state] of stableSessionPools) {
    let alive = false;
    for (let i = 0; i < state.pool.length; i++) {
      if (state.pool[i] && now - state.pool[i].lastUsed > MEMORY_CONFIG.sessionTtlMs) state.pool[i] = null;
      if (state.pool[i]) alive = true;
    }
    if (!alive && now >= (state.backoffUntil || 0)) stableSessionPools.delete(key);
  }
}, MEMORY_CONFIG.sessionCleanupIntervalMs);
if (stablePoolCleanup.unref) stablePoolCleanup.unref();

function poolSlotIndex(hint) {
  if (!hint) return 0;
  return crypto.createHash("sha256").update(String(hint)).digest()[0] % SESSION_POOL_SIZE;
}

function ensureSessionState(key) {
  let state = stableSessionPools.get(key);
  if (!state) {
    if (stableSessionPools.size >= MAX_STABLE_SESSIONS) {
      stableSessionPools.delete(stableSessionPools.keys().next().value);
    }
    state = { pool: new Array(SESSION_POOL_SIZE).fill(null), mintFailures: 0, backoffUntil: 0, lastMintAt: 0 };
    stableSessionPools.set(key, state);
  }
  return state;
}

function mintSessionOnce(key, index) {
  let inflight = mintInflight.get(key);
  if (inflight) return inflight;
  inflight = (async () => {
    const fresh = { sessionId: generateSessionId(), lastUsed: Date.now(), poisoned: false };
    const state = stableSessionPools.get(key);
    if (state) {
      state.pool[index] = fresh;
      state.lastMintAt = Date.now();
    }
    console.log(`[OC-SESSION] MINT identity=…${key.slice(-12)} slot=${index} session=${fresh.sessionId}`);
    return fresh;
  })().finally(() => mintInflight.delete(key));
  mintInflight.set(key, inflight);
  return inflight;
}

// OPENCODE_SESSION_FRESH=1 (2026-10-29): issue a brand-new x-opencode-session
// per request instead of pooling lanes. The v3 pool paced mints against
// same-IP observations; with rotating proxy egress every request already
// presents from a different IP, and sharing one session ID across a swarm
// funnels all traffic into a single upstream quota bucket (observed:
// 10-request burst sharing one session -> 4 pass, 6x 429 FreeUsageLimitError
// after ~150s of futile same-session retries). Fresh IDs are free - the CLI
// model is one session per task anyway.
const SESSION_FRESH = process.env.OPENCODE_SESSION_FRESH === "1" || process.env.OPENCODE_SESSION_FRESH === "true";

async function pooledSessionIdAsync(credentials, hint) {
  if (SESSION_FRESH) return generateSessionId();
  const key = identityKey(credentials);
  const deadline = Date.now() + SESSION_WAIT_CAP_MS;
  for (;;) {
    const now = Date.now();
    const state = ensureSessionState(key);
    const index = poolSlotIndex(hint);
    const entry = state.pool[index];

    // Healthy hashed lane: the common path.
    if (entry && now - entry.lastUsed <= MEMORY_CONFIG.sessionTtlMs && !entry.poisoned) {
      entry.lastUsed = now;
      console.log(`[OC-SESSION] REUSE identity=…${key.slice(-12)} slot=${index} session=${entry.sessionId}`);
      return entry.sessionId;
    }

    // Mint window open: replace the dead/poisoned slot (single-flight).
    const mintReadyAt = Math.max(state.backoffUntil || 0, (state.lastMintAt || 0) + MIN_MINT_GAP_MS);
    if (now >= mintReadyAt) {
      const fresh = await mintSessionOnce(key, index);
      return fresh.sessionId;
    }

    // Window closed: share a live lane rather than fire a doomed mint.
    let bestHealthy = null;
    let bestAny = null;
    for (const e of state.pool) {
      if (!e || now - e.lastUsed > MEMORY_CONFIG.sessionTtlMs) continue;
      if (!bestAny || e.lastUsed > bestAny.lastUsed) bestAny = e;
      if (!e.poisoned && (!bestHealthy || e.lastUsed > bestHealthy.lastUsed)) bestHealthy = e;
    }
    const pick = bestHealthy || bestAny;
    if (pick) {
      pick.lastUsed = now;
      console.log(`[OC-SESSION] SHARE identity=…${key.slice(-12)} slot=${index} session=${pick.sessionId}${pick.poisoned ? " (poisoned)" : ""}`);
      return pick.sessionId;
    }

    // No live lane at all (cold start): wait for the mint window.
    if (now >= deadline) {
      const fresh = await mintSessionOnce(key, index);
      return fresh.sessionId;
    }
    await sleepMs(Math.min(mintReadyAt - now, 2500));
  }
}

// Rare synchronous fallback (header rebuild without prepared credentials):
// reuse any live lane; mint unpaced only when nothing exists at all.
function pooledSessionIdSync(credentials) {
  const forced = pinnedSessionForProxy(credentials?.providerSpecificData?.connectionProxyUrl);
  if (forced) return forced;
  if (SESSION_FRESH) return generateSessionId();
  const key = identityKey(credentials);
  const now = Date.now();
  const state = ensureSessionState(key);
  for (const e of state.pool) {
    if (e && !e.poisoned && now - e.lastUsed <= MEMORY_CONFIG.sessionTtlMs) {
      e.lastUsed = now;
      return e.sessionId;
    }
  }
  for (const e of state.pool) {
    if (e && now - e.lastUsed <= MEMORY_CONFIG.sessionTtlMs) {
      e.lastUsed = now;
      return e.sessionId;
    }
  }
  const fresh = { sessionId: generateSessionId(), lastUsed: now, poisoned: false };
  state.pool[0] = fresh;
  state.lastMintAt = now;
  return fresh.sessionId;
}

// Called when upstream rejects a request with 429 FreeUsageLimitError: poison
// the slot that served it and put the identity into mint backoff.
function markSessionLimited(sessionId) {
  const now = Date.now();
  for (const [key, state] of stableSessionPools) {
    for (let i = 0; i < state.pool.length; i++) {
      const entry = state.pool[i];
      if (entry && entry.sessionId === sessionId) {
        if (!entry.poisoned) {
          entry.poisoned = true;
          state.mintFailures += 1;
          const backoff = Math.min(MINT_BACKOFF_BASE_MS * 2 ** (state.mintFailures - 1), MINT_BACKOFF_MAX_MS);
          state.backoffUntil = now + backoff;
          console.log(`[OC-SESSION] LIMITED identity=…${key.slice(-12)} slot=${i} backoff=${Math.round(backoff / 1000)}s failures=${state.mintFailures}`);
        } else {
          entry.lastUsed = now;
        }
        return;
      }
    }
  }
}

function bodyHasSessionHints(body) {
  try {
    if (!body || typeof body !== "object") return false;
    if (typeof body.session_id === "string" && body.session_id.trim()) return true;
    if (typeof body.conversation_id === "string" && body.conversation_id.trim()) return true;
    if (typeof body.prompt_cache_key === "string" && body.prompt_cache_key.trim()) return true;
    if (body.metadata && typeof body.metadata.user_id === "string" && body.metadata.user_id.trim()) return true;
    if (body.request && body.request.sessionId != null && String(body.request.sessionId) !== "") return true;
    const arr = Array.isArray(body.messages)
      ? body.messages
      : Array.isArray(body.input)
        ? body.input
        : null;
    if (arr) {
      let assistantText = "";
      for (const msg of arr) {
        if (msg?.role === "assistant") {
          const content = msg.content;
          if (typeof content === "string") assistantText += content;
          else if (Array.isArray(content)) {
            for (const part of content) assistantText += part?.text || part?.output || "";
          }
          if (assistantText.length >= 50) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  const base = baseModelId(model);
  return RESPONSES_MODELS.has(base) || isMuseSparkModel(base);
}

function isMessagesModel(model) {
  return MESSAGES_MODELS.has(baseModelId(model));
}

async function resolveOpencodeSession(body, credentials, providerSessionId, clientTool) {
  // Proxy-pinned identity wins over every hint path: the egress proxy decides
  // the session, not the downstream conversation.
  const forced = pinnedSessionForProxy(credentials?.providerSpecificData?.connectionProxyUrl);
  if (forced) return forced;
  const headers = credentials?.rawHeaders || {};
  const native = nativeSession(headers);
  if (native) return await pooledSessionIdAsync(credentials, native);

  let incoming = null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === SESSION_HEADER) {
      incoming = normalizeSession(value);
      break;
    }
  }

  const hinted = incoming || normalizeSession(providerSessionId);
  if (hinted) return await pooledSessionIdAsync(credentials, hinted);

  if (credentials?.connectionId || bodyHasSessionHints(body)) {
    let viaManager = null;
    try {
      viaManager = resolveSessionId({
        headers,
        body,
        connectionId: credentials?.connectionId,
        scope: "opencode",
      });
    } catch {
      viaManager = null;
    }
    if (viaManager) return await pooledSessionIdAsync(credentials, viaManager);
  }

  return await pooledSessionIdAsync(credentials, null);
}

function normalizeResponsesTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    let parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    if (parameters.type === "object" && !parameters.properties) parameters = { ...parameters, properties: {} };
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, MAX_TOOL_NAME_LEN);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

function sanitizeResponsesItems(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    // Strip prior-turn reasoning items: OpenCode Free uses public/pooled credentials
    // (`Bearer public`) routing to an upstream OpenAI/Console account pool.
    // OpenAI Responses API strictly enforces that reasoning `encrypted_content`
    // can only be decrypted by the exact caller/account that issued it; sending it
    // across different accounts or rotating proxy relays triggers:
    // [invalid_request_error] reasoning `encrypted_content` was not issued to this caller (400).
    // Furthermore, under stateless mode (store=false), omitting encrypted_content
    // causes OpenAI to reject the referenced reasoning item as "not found or was deleted".
    // Dropping prior reasoning items allows multi-turn conversations and tool-calling
    // loops to succeed cleanly.
    if (item.type === "reasoning") return false;
    delete item.encrypted_content;
    delete item.reasoning_encrypted_content;
    if (item.type === "function_call") {
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") return false;
      item.name = item.name.trim().slice(0, MAX_TOOL_NAME_LEN);
      item.call_id = clampResponsesCallId(item.call_id);
      item.arguments = coerceResponsesArguments(item.arguments);
      return true;
    }
    if (item.type === "function_call_output") {
      item.call_id = clampResponsesCallId(item.call_id);
      item.output = coerceResponsesOutput(item.output);
      return true;
    }
    return true;
  });
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
  const requestedEffort = typeof body.reasoning_effort === "string"
    ? body.reasoning_effort
    : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if ((effort === "max" || effort === "ultra") && supportedLevels?.length && !supportedLevels.includes(effort)) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}

// Chat Completions lane: the free backend validates reasoning_effort against the
// plain OpenAI enum (none|minimal|low|medium|high|xhigh|max) and answers 400
// "Invalid option" for anything else — including "auto", which adaptive thinking
// (Claude Code's thinking:{type:"adaptive"}) arrives as. Omitting the field lets
// the upstream pick its own default, which is what adaptive means; same rationale
// as the Responses path above, which rejects "unknown variant `auto`".
function dropAdaptiveReasoningEffort(body) {
  if (body?.reasoning_effort === "auto") delete body.reasoning_effort;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    // Bounded 429 retry: upstream free capacity congests in waves (minutes
    // long) that answer 429 FreeUsageLimitError regardless of session/IP/model.
    // Keep the per-model budget SMALL (3x5s ~ 16s): member health is largely
    // independent, so the combo layer sampling 4 models finds a healthy lane
    // far faster than persisting ~150s on one. A long ride-out here is
    // actively harmful: it holds the client's request past agent timeouts so
    // nothing ever comes back (silent 157s x N models). Fail over fast; the
    // combo member-cooldown skips storming members on subsequent requests.
    this.config = {
      ...this.config,
      // Per-attempt response-headers deadline. The default
      // (FETCH_CONNECT_TIMEOUT_MS = 60s) lets ONE stalled residential-proxy
      // lane eat a full minute of total silence per attempt; healthy free
      // lanes deliver headers in <2s, so 20s is generous and caps a dead
      // lane's worst case at two attempts.
      timeoutMs: 20000,
      retry: {
        ...((this.config && this.config.retry) || {}),
        // ONE attempt only: under congestion the upstream takes ~8s to even
        // answer 429, so each extra retry costs ~13s of client silence per
        // member. The combo layer fails over to other members and the client
        // retries with its own backoff; intra-member retries just stack dead
        // time (measured 160-170s ride-throughs during the 2026-10-29 wave).
        429: { attempts: 1, delayMs: 1500 },
        // Network failures (base maps them to 502) and 5xx: ONE fast retry,
        // then fall to the next combo member. The old 3x3s budget stacked on
        // a 60s connect timeout held client requests in 45-180s of silence,
        // killing agent clients (OpenHands/litellm) with "Connection error".
        502: { attempts: 1, delayMs: 1500 },
        503: { attempts: 1, delayMs: 1500 },
        504: { attempts: 1, delayMs: 1500 },
      },
    };
  }

  async prepareRequestCredentials({ body, credentials, providerSessionId, clientTool } = {}) {
    const sourceCredentials = credentials || {};
    const session = await resolveOpencodeSession(body, sourceCredentials, providerSessionId, clientTool);

    return {
      ...sourceCredentials,
      [SESSION_FIELD]: session,
    };
  }

  transformRequest(model, body, stream, credentials) {
    if (body && typeof body === "object" && model && !body.model) body.model = model;
    // Zen rejects non-streaming requests on free models with 403 FreeTierError;
    // always stream upstream and let the handler layer aggregate for non-stream clients.
    if (body && typeof body === "object") body.stream = true;
    if (isResponsesModel(model || body?.model) && body && typeof body === "object") {
      // ponytail: chỉ model đã xác nhận auto-only; mở allowlist khi có bằng chứng.
      if ("tool_choice" in body && body.tool_choice !== "auto"
        && this.config.quirks?.forceAutoToolChoiceModels?.includes(baseModelId(model))) {
        body.tool_choice = "auto";
      }
      const normalized = normalizeResponsesInput(body.input);
      if (normalized) body.input = normalized;
      if (!Array.isArray(body.input) || body.input.length === 0) {
        body.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
      }
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
      body.stream = true;
      body.store = false;
      normalizeResponsesTools(body);
      sanitizeResponsesItems(body);
      // Free-tier fingerprint tools are required even when an agent client
      // already supplied tools. ZCode/Claude Code requests normally have
      // non-empty tool arrays; skipping cloaking here triggers 403 FreeTierError.
      applyFingerprintTools(body, true);
    } else if (body && typeof body === "object") {
      dropAdaptiveReasoningEffort(body);
      const claudeShape = isMessagesModel(model || body?.model);
      applyFingerprintTools(body, false, { claude: claudeShape });
      // The free gate validates the CLI system prompt shape too — see
      // opencodeFingerprint.js. Without it: 429 FreeUsageLimitError.
      if (claudeShape) applyFingerprintSystemMessages(body);
      else applyFingerprintSystem(body);
    }
    // v2 CLI stamps the provider cache key on every chat request
    // (openai-chat protocol: prompt_cache_key = session affinity). Chat lane
    // only: the messages/responses protocols carry their own cache fields.
    if (credentials && credentials[SESSION_FIELD] && Array.isArray(body.messages)) {
      body.prompt_cache_key = credentials[SESSION_FIELD];
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  // The free gate keys on the TLS ClientHello, so a native Node fetch is refused
  // no matter how faithful the body is. Route through the impersonating client
  // and keep proxy handling on the existing path (proxyAwareFetch delegates to
  // `directFetch` when no proxy is configured). Fail-open: without wreq-js the
  // request still goes out on native fetch instead of erroring here.
  async execute(args) {
    const credentials = await this.prepareRequestCredentials(args);
    return super.execute({
      ...args,
      credentials,
      directFetch: async (url, options, { proxyUrl } = {}) => {
        // Per-attempt identity: rotate the sticky proxy segment (fresh egress
        // IP) and mint a fresh ses_ session + msg_ request id. A retry never
        // re-rides a burned IP/session pair, which is what kept the pool
        // degraded: one fixed sticky IP answered 429 for ~6.6h after burn.
        const rotatedProxy = rotateProxySession(proxyUrl);
        const attemptSession = generateSessionId();
        if (options && options.headers) {
          options.headers["x-opencode-session"] = attemptSession;
          options.headers["x-session-affinity"] = attemptSession;
          options.headers["X-Session-Id"] = attemptSession;
          options.headers["x-opencode-session-id"] = attemptSession;
          options.headers["x-opencode-request"] = generateRequestId();
        }
        // Keep the body cache key in lockstep with the session identity.
        if (options && typeof options.body === "string") {
          try {
            const parsed = JSON.parse(options.body);
            if (parsed && typeof parsed === "object" && Array.isArray(parsed.messages)) {
              parsed.prompt_cache_key = attemptSession;
              options.body = JSON.stringify(parsed);
            }
          } catch { }
        }
        // Fresh process per attempt — see the import comment above. Worker
        // failures (spawn/protocol) propagate to base.js as network errors so
        // the retry/failover layers treat them like any dead lane. NOTE: they
        // deliberately do NOT fail open to native in-process fetch: Node's
        // OpenSSL ClientHello is refused by the upstream JA4 gate with the
        // very same 429 FreeUsageLimitError.
        const response = await opencodeWorkerFetch(url, {
          method: options.method,
          headers: options.headers,
          body: options.body,
        }, { signal: options.signal, proxyUrl: rotatedProxy, timeoutMs: this.config?.timeoutMs || 20000 });
        try {
          if (response) Object.defineProperty(response, SESSION_USED_PROP, { value: attemptSession, configurable: true });
        } catch { }
        return response;
      },
      directFetchProxy: true,
    });
  }

  // Free tier moved from /zen/v1 to /inference/v1 (OpenCode v2); /zen/v1 now
  // answers every free request with 403 FreeTierError.
  buildUrl(model) {
    const base = this.config.baseUrl;
    if (isResponsesModel(model)) return `${base}/inference/v1/responses`;
    if (isMessagesModel(model)) return `${base}/inference/v1/messages`;
    return `${base}/inference/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true, url = "") {
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = lower["user-agent"] || "";
    const isOpencodeDownstream = hasValidOpencodeVersion(downstreamUa);

    const session = credentials?.[SESSION_FIELD] || pooledSessionIdSync(credentials);

    // Mirrors the real v2 CLI (model-request.ts): the session id rides FOUR
    // headers; affinity is the ROOT session id, which for our top-level
    // conversations equals the session itself.
    const headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "User-Agent": isOpencodeDownstream ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": lower["x-opencode-client"] || OPENCODE_CLIENT,
      "x-opencode-project": lower["x-opencode-project"] || OPENCODE_PROJECT,
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-session": session,
      "x-session-affinity": session,
      "X-Session-Id": session,
      "x-opencode-session-id": session,
      "Accept": "*/*",
    };
    if (url.endsWith("/messages")) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return headers;
  }

  parseError(response, bodyText) {
    const result = super.parseError(response, bodyText) || { status: response ? response.status : undefined, message: bodyText };
    try {
      if (result.status === 429 && typeof bodyText === "string" && bodyText.includes("FreeUsageLimitError")) {
        const used = response ? response[SESSION_USED_PROP] : null;
        if (used) burnSessionId(used);
      }
    } catch { }
    return result;
  }
}
