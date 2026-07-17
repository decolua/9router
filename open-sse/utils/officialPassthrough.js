/**
 * Official ChatGPT / Codex backend passthrough.
 *
 * Protects native Codex Desktop/CLI usage when base_url points at 9router:
 *   model_provider = "OpenAI", base_url = http://localhost:20128/v1
 *
 * Gates (ALL required):
 *   1. Client is Codex (see isCodexClient)
 *   2. Path is an official surface (/v1/responses, /v1/alpha/search, …)
 *   3. model is absent OR matches /^gpt-/i  (cx/*, minimax-cn/*, … → normal routing)
 *
 * Outbound auth uses ~/.codex/auth.json (ChatGPT JWT). Client experimental_bearer
 * tokens (sk-9router) are NOT forwarded to chatgpt.com.
 *
 * Config (optional kill-switch): ~/.9router/official-passthrough.json
 *   { "enabled": true, "fallbackCodexAuthJson": true, "codexAuthPath": null }
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proxyAwareFetch } from "./proxyFetch.js";
import { isCodexClient, normalizeHeaders } from "./clientDetector.js";

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

const CHATGPT_CODEX_BASE = "https://chatgpt.com/backend-api/codex";

const DEFAULT_CONFIG = {
  enabled: true,
  fallbackCodexAuthJson: true,
  /** Optional absolute path to Codex auth.json (default: ~/.codex/auth.json) */
  codexAuthPath: null,
};

let cachedConfig = null;
let cachedConfigMtimeMs = null;
let cachedConfigPath = null;

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

export function getOfficialPassthroughConfigPath() {
  if (process.env.OFFICIAL_PASSTHROUGH_CONFIG) {
    return process.env.OFFICIAL_PASSTHROUGH_CONFIG;
  }
  return path.join(resolveDataDir(), "official-passthrough.json");
}

function ensureConfigFile(configPath) {
  try {
    if (fs.existsSync(configPath)) return;
    const dir = path.dirname(configPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      configPath,
      `${JSON.stringify({
        ...DEFAULT_CONFIG,
        _comment: "Codex official passthrough. enabled=false disables all passthrough. Non-gpt-* models always route via 9router.",
      }, null, 2)}\n`,
      "utf-8"
    );
  } catch {
    // fail-open on write errors; load still returns defaults
  }
}

/**
 * @returns {{ enabled: boolean, fallbackCodexAuthJson: boolean, codexAuthPath: string|null, path: string }}
 */
export function loadOfficialPassthroughConfig({ forceReload = false } = {}) {
  const configPath = getOfficialPassthroughConfigPath();
  ensureConfigFile(configPath);

  let mtimeMs = null;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    mtimeMs = null;
  }

  if (
    !forceReload
    && cachedConfig
    && cachedConfigPath === configPath
    && cachedConfigMtimeMs === mtimeMs
  ) {
    return cachedConfig;
  }

  let parsed = { ...DEFAULT_CONFIG };
  try {
    if (mtimeMs != null) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const json = JSON.parse(raw);
      if (json && typeof json === "object" && !Array.isArray(json)) {
        parsed = { ...DEFAULT_CONFIG, ...json };
      }
    }
  } catch {
    parsed = { ...DEFAULT_CONFIG };
  }

  cachedConfig = {
    enabled: parsed.enabled !== false,
    fallbackCodexAuthJson: parsed.fallbackCodexAuthJson !== false,
    codexAuthPath: typeof parsed.codexAuthPath === "string" && parsed.codexAuthPath.trim()
      ? parsed.codexAuthPath.trim()
      : null,
    path: configPath,
  };
  cachedConfigPath = configPath;
  cachedConfigMtimeMs = mtimeMs;
  return cachedConfig;
}

/** @internal test helper */
export function _resetOfficialPassthroughCache() {
  cachedConfig = null;
  cachedConfigMtimeMs = null;
  cachedConfigPath = null;
}

export function normalizeRequestPath(pathname) {
  let p = String(pathname || "");
  if (p.startsWith("/api/")) p = p.slice(4);
  if (!p.startsWith("/")) p = `/${p}`;
  // collapse trailing slash except root
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/**
 * Paths that belong to the official Codex surface when base_url ends with /v1.
 */
export function isOfficialSurfacePath(pathname) {
  const p = normalizeRequestPath(pathname);
  if (p === "/v1/responses" || p === "/responses") return true;
  if (p === "/v1/responses/compact" || p.endsWith("/responses/compact")) return true;
  if (p === "/codex" || p.startsWith("/codex/")) return true;
  if (p === "/v1/alpha/search" || p.startsWith("/v1/alpha/")) return true;
  return false;
}

/**
 * Official passthrough model rule: gpt-* only.
 * Prefixed ids (cx/gpt-5.6-sol, minimax-cn/…) are treated as 9router-routed.
 */
export function isGptOfficialModel(modelStr) {
  if (modelStr == null || modelStr === "") return null; // absent
  if (typeof modelStr !== "string") return false;
  const m = modelStr.trim();
  if (!m) return null;
  // Must be bare gpt-* (no provider prefix)
  if (m.includes("/")) return false;
  return /^gpt-/i.test(m);
}

/**
 * @param {object} opts
 * @param {Headers|object} opts.headers
 * @param {object} [opts.body]
 * @param {string} opts.pathname
 * @param {object} [opts.config]
 */
export function shouldOfficialPassthrough({ headers, body = {}, pathname, config = null } = {}) {
  const cfg = config || loadOfficialPassthroughConfig();
  if (!cfg.enabled) return false;
  if (!isCodexClient(headers, body)) return false;
  if (!isOfficialSurfacePath(pathname)) return false;

  const modelCheck = isGptOfficialModel(body?.model);
  // non-gpt / prefixed → route via 9router
  if (modelCheck === false) return false;
  // gpt-* or absent model on official surface → passthrough
  return true;
}

/**
 * Map gateway path → ChatGPT codex backend URL.
 * /v1/responses → …/codex/responses
 * /v1/alpha/search → …/codex/alpha/search
 */
export function resolveOfficialPassthroughUrl(pathname) {
  const p = normalizeRequestPath(pathname);

  if (p === "/codex" || p.startsWith("/codex/")) {
    const rest = p === "/codex" ? "/responses" : p.slice("/codex".length) || "/responses";
    return `${CHATGPT_CODEX_BASE}${rest.startsWith("/") ? rest : `/${rest}`}`;
  }

  if (p === "/responses") {
    return `${CHATGPT_CODEX_BASE}/responses`;
  }

  // Strip /v1 prefix when present
  let rest = p.startsWith("/v1/") ? p.slice(3) : p;
  if (!rest.startsWith("/")) rest = `/${rest}`;
  // /responses, /responses/compact, /alpha/search, …
  return `${CHATGPT_CODEX_BASE}${rest}`;
}

function getHeader(headers, name) {
  const h = normalizeHeaders(headers);
  return h[name.toLowerCase()];
}

function extractAccountIdFromJwt(token) {
  if (!token || typeof token !== "string" || token.split(".").length < 2) return null;
  try {
    const payloadB64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = (4 - (payloadB64.length % 4)) % 4;
    const payload = JSON.parse(Buffer.from(payloadB64 + "=".repeat(pad), "base64").toString("utf-8"));
    const auth = payload?.["https://api.openai.com/auth"] || {};
    return auth.chatgpt_account_id || payload.chatgpt_account_id || payload.account_id || null;
  } catch {
    return null;
  }
}

export function readCodexAuthJson(codexAuthPath) {
  const authPath = codexAuthPath || path.join(os.homedir(), ".codex", "auth.json");
  try {
    if (!fs.existsSync(authPath)) return null;
    const data = JSON.parse(fs.readFileSync(authPath, "utf-8"));
    const accessToken =
      data?.tokens?.access_token
      || data?.access_token
      || data?.accessToken
      || null;
    let accountId =
      data?.tokens?.account_id
      || data?.account_id
      || data?.chatgpt_account_id
      || data?.tokens?.chatgpt_account_id
      || null;
    if (!accountId && typeof accessToken === "string") {
      accountId = extractAccountIdFromJwt(accessToken);
    }
    return {
      accessToken: typeof accessToken === "string" ? accessToken : null,
      accountId: typeof accountId === "string" ? accountId : null,
      path: authPath,
    };
  } catch {
    return null;
  }
}

function isLikelyGatewayApiKey(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  // 9router / sk- keys are not ChatGPT access tokens
  if (token.startsWith("sk-") || token.startsWith("sk_")) return true;
  if (token.length < 40) return true;
  // JWT starts with eyJ
  if (token.startsWith("eyJ")) return false;
  return false;
}

function buildForwardHeaders(clientHeaders, { authHeader, accountId }) {
  const raw = normalizeHeaders(clientHeaders);
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (HOP_BY_HOP.has(key)) continue;
    if (key.startsWith("x-9r-")) continue;
    if (key === "x-forwarded-for" || key === "x-forwarded-host" || key === "x-forwarded-proto") continue;
    // Drop gateway bearer; we set Authorization explicitly
    if (key === "authorization") continue;
    if (val == null || val === "") continue;
    out[key] = val;
  }

  if (authHeader) {
    out.authorization = authHeader.startsWith("Bearer ") || authHeader.startsWith("bearer ")
      ? authHeader
      : `Bearer ${authHeader}`;
  }

  if (accountId && !out["chatgpt-account-id"]) {
    out["chatgpt-account-id"] = accountId;
  }

  if (!out["content-type"]) {
    out["content-type"] = "application/json";
  }

  return out;
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    ...extra,
  };
}

/**
 * Transparent reverse-proxy of the current request to ChatGPT codex backend.
 * @param {Request} request
 * @param {object} body - already-parsed JSON body
 * @param {{ log?: object, pathname?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function handleOfficialPassthrough(request, body, options = {}) {
  const log = options.log || null;
  const cfg = loadOfficialPassthroughConfig();

  let pathname = options.pathname || "/v1/responses";
  try {
    pathname = options.pathname || new URL(request.url).pathname || pathname;
  } catch {
    // keep default
  }

  const clientAuth = request.headers?.get?.("authorization") || getHeader(request.headers, "authorization");
  const clientAccountId = request.headers?.get?.("chatgpt-account-id")
    || getHeader(request.headers, "chatgpt-account-id");

  let accessToken = null;
  let accountId = clientAccountId || null;
  let authSource = "none";

  // Prefer ChatGPT JWT from client if present (rare when experimental_bearer is set)
  if (clientAuth && !isLikelyGatewayApiKey(clientAuth)) {
    accessToken = clientAuth.replace(/^Bearer\s+/i, "").trim();
    authSource = "client";
  }

  if ((!accessToken || !accountId) && cfg.fallbackCodexAuthJson) {
    const codexAuth = readCodexAuthJson(cfg.codexAuthPath);
    if (codexAuth?.accessToken) {
      if (!accessToken) {
        accessToken = codexAuth.accessToken;
        authSource = "codex-auth.json";
      }
      if (!accountId && codexAuth.accountId) {
        accountId = codexAuth.accountId;
      }
    }
  }

  if (!accessToken) {
    log?.warn?.("PASSTHROUGH", "No ChatGPT access token (client JWT or ~/.codex/auth.json)");
    return new Response(JSON.stringify({
      error: {
        message: "Official passthrough requires ChatGPT auth (~/.codex/auth.json access_token)",
        type: "invalid_request_error",
        code: "passthrough_auth_missing",
      },
    }), {
      status: 401,
      headers: corsHeaders({ "Content-Type": "application/json" }),
    });
  }

  const targetUrl = resolveOfficialPassthroughUrl(pathname);
  const forwardHeaders = buildForwardHeaders(request.headers, {
    authHeader: `Bearer ${accessToken}`,
    accountId,
  });

  const model = body?.model || "";
  log?.info?.(
    "PASSTHROUGH",
    `Codex → ${targetUrl} · model=${model || "(none)"} · auth=${authSource}`
  );

  let upstream;
  try {
    upstream = await proxyAwareFetch(targetUrl, {
      method: request.method || "POST",
      headers: forwardHeaders,
      body: JSON.stringify(body ?? {}),
      signal: request.signal,
    });
  } catch (err) {
    log?.error?.("PASSTHROUGH", `Upstream fetch failed: ${err?.message || err}`);
    return new Response(JSON.stringify({
      error: {
        message: `Official passthrough upstream error: ${err?.message || err}`,
        type: "api_error",
        code: "passthrough_upstream_error",
      },
    }), {
      status: 502,
      headers: corsHeaders({ "Content-Type": "application/json" }),
    });
  }

  // Stream body through; copy safe response headers
  const respHeaders = corsHeaders();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "content-encoding") return; // fetch already decoded
    respHeaders[key] = value;
  });
  if (!respHeaders["content-type"] && !respHeaders["Content-Type"]) {
    respHeaders["Content-Type"] = upstream.headers.get("content-type") || "application/json";
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}
