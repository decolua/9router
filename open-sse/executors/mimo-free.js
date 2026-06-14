import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { createHash } from "crypto";
import os from "os";

const BOOTSTRAP_URL = "https://api.xiaomimimo.com/api/free-ai/bootstrap";
const CHAT_URL = "https://api.xiaomimimo.com/api/free-ai/openai/chat";
const SESSION_AFFINITY_PREFIX = "ses_";
const SESSION_ID_LENGTH = 24;
const JWT_FALLBACK_TTL_SEC = 3000;
const JWT_EXPIRY_BUFFER_MS = 300000;
const SESSION_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

// Anti-abuse gate marker: the free chat endpoint returns 403 "Illegal access"
// unless a system message contains this exact MiMoCode signature substring.
export const MIMO_SYSTEM_MARKER =
  "You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.";

// In-memory JWT cache (per-process, survives across requests but not restarts)
let cachedJwt = null;
let jwtExpiresAt = 0;

// Device fingerprint reused as the bootstrap "client" — stable per machine
function generateFingerprint() {
  let username = "unknown-user";
  try {
    username = os.userInfo().username;
  } catch {
    // ignore
  }
  const cpu = (os.cpus()[0]?.model || "unknown-cpu").trim();
  const seed = `${os.hostname()}|${os.platform()}|${os.arch()}|${cpu}|${username}`;
  return createHash("sha256").update(seed).digest("hex");
}

function generateSessionId() {
  let id = SESSION_AFFINITY_PREFIX;
  for (let i = 0; i < SESSION_ID_LENGTH; i++) {
    id += SESSION_CHARS[Math.floor(Math.random() * SESSION_CHARS.length)];
  }
  return id;
}

// Derive expiry from the JWT exp claim; fall back to a fixed TTL when unparseable
function parseJwtExp(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString());
    if (payload.exp) return payload.exp * 1000;
  } catch {
    // ignore
  }
  return Date.now() + JWT_FALLBACK_TTL_SEC * 1000;
}

// Ensure the body carries the anti-abuse marker in a system message (idempotent)
function injectSystemMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return body;
  const hasMarker = messages.some(
    (m) => m?.role === "system" && typeof m.content === "string" && m.content.includes(MIMO_SYSTEM_MARKER)
  );
  if (hasMarker) return body;
  return { ...body, messages: [{ role: "system", content: MIMO_SYSTEM_MARKER }, ...messages] };
}

function resetJwtCache() {
  cachedJwt = null;
  jwtExpiresAt = 0;
}

async function bootstrapJwt(proxyOptions = null) {
  if (cachedJwt && Date.now() < jwtExpiresAt - JWT_EXPIRY_BUFFER_MS) {
    return cachedJwt;
  }

  const response = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: generateFingerprint() }),
  }, proxyOptions);

  if (!response.ok) {
    throw new Error(`MiMo bootstrap failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.jwt) {
    throw new Error("MiMo bootstrap returned no JWT");
  }

  cachedJwt = data.jwt;
  jwtExpiresAt = parseJwtExp(data.jwt);
  return cachedJwt;
}

export class MimoFreeExecutor extends BaseExecutor {
  constructor() {
    super("mimo-free", PROVIDERS["mimo-free"]);
    this.sessionId = generateSessionId();
  }

  buildUrl() {
    return CHAT_URL;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      "X-Mimo-Source": "mimocode-cli-free",
      "x-session-affinity": this.sessionId,
      "Accept": stream ? "text/event-stream" : "application/json",
    };
  }

  transformRequest(model, body) {
    return injectSystemMarker(body);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    let jwt;
    try {
      jwt = await bootstrapJwt(proxyOptions);
    } catch (error) {
      log?.error?.("AUTH", `MiMo bootstrap failed: ${error.message}`);
      throw error;
    }

    const url = this.buildUrl();
    const transformedBody = this.transformRequest(model, body);
    const headers = { ...this.buildHeaders(credentials, stream), "Authorization": `Bearer ${jwt}` };
    const bodyStr = JSON.stringify(transformedBody);
    log?.debug?.("FETCH", `MIMO-FREE → ${url} | body=${bodyStr.length}B`);

    const response = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions);

    // On auth failure, invalidate cache and retry once with a fresh JWT
    if (response.status === 401 || response.status === 403) {
      log?.debug?.("AUTH", `MiMo auth failed (${response.status}), re-bootstrapping...`);
      resetJwtCache();
      jwt = await bootstrapJwt(proxyOptions);
      headers["Authorization"] = `Bearer ${jwt}`;
      const retryResponse = await proxyAwareFetch(url, { method: "POST", headers, body: bodyStr, signal }, proxyOptions);
      return { response: retryResponse, url, headers, transformedBody };
    }

    return { response, url, headers, transformedBody };
  }
}

export const __test__ = {
  generateFingerprint, generateSessionId, bootstrapJwt, resetJwtCache, parseJwtExp,
  injectSystemMarker, MIMO_SYSTEM_MARKER, BOOTSTRAP_URL, CHAT_URL, SESSION_AFFINITY_PREFIX,
};

export default MimoFreeExecutor;
