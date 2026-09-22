/**
 * Cursor live model catalog fetcher.
 *
 * Cursor exposes the account-specific model picker through the AgentService
 * `GetUsableModels` Connect RPC. Unlike the static provider registry, this
 * includes models newly enabled for the account and omits unavailable ones.
 *
 * The endpoint is HTTP/2-only. Direct http2.connect() ignores HTTP_PROXY, so
 * when a proxy pool / outbound proxy is configured we tunnel h2 through
 * CONNECT or SOCKS (see utils/http2Connect.js).
 */

import crypto from "crypto";
import { PROVIDER_OAUTH } from "../providers/index.js";
import { buildCursorHeaders } from "../utils/cursorChecksum.js";
import { decodeMessage } from "../utils/cursorProtobuf.js";
import { connectHttp2 } from "../utils/http2Connect.js";
import { resolveOutboundProxyUrl } from "../utils/proxyFetch.js";

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

// agent.v1.ModelDetails protobuf field numbers.
const MODEL_ID_FIELD = 1;
const DISPLAY_MODEL_ID_FIELD = 3;
const DISPLAY_NAME_FIELD = 4;
const DISPLAY_NAME_SHORT_FIELD = 5;
const RESPONSE_MODELS_FIELD = 1;

/** @type {Map<string, { expiresAt: number, models: { id: string, name: string }[] }>} */
const catalogCache = new Map();

function getCursorModelsUrl() {
  const config = PROVIDER_OAUTH.cursor;
  if (!config?.agentEndpoint || !config?.modelsEndpoint) return null;
  return `${config.agentEndpoint.replace(/\/$/, "")}${config.modelsEndpoint}`;
}

function cacheKey(credentials, proxyUrl = "") {
  const seed = [
    credentials?.providerSpecificData?.machineId,
    credentials?.accessToken,
    proxyUrl || "direct",
  ].filter(Boolean).join(":");
  if (!seed) return "cursor-anonymous";
  return crypto.createHash("sha256").update(`cursor:${seed}`).digest("hex");
}

function firstString(fields, fieldNumber) {
  const value = fields.get(fieldNumber)?.[0]?.value;
  if (!value || typeof value === "number") return "";
  return Buffer.from(value).toString("utf8");
}

function maskProxyUrl(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.password) parsed.password = "***";
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "proxy";
  }
}

/**
 * Decode Cursor's `agent.v1.GetUsableModelsResponse` protobuf payload.
 * The response contains repeated `agent.v1.ModelDetails` messages in field 1.
 */
export function parseCursorUsableModels(payload) {
  const response = decodeMessage(payload);
  const seen = new Set();
  const models = [];

  for (const entry of response.get(RESPONSE_MODELS_FIELD) || []) {
    if (!entry?.value || typeof entry.value === "number") continue;
    const detail = decodeMessage(entry.value);
    const id = firstString(detail, MODEL_ID_FIELD).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const name = (
      firstString(detail, DISPLAY_NAME_FIELD)
      || firstString(detail, DISPLAY_NAME_SHORT_FIELD)
      || firstString(detail, DISPLAY_MODEL_ID_FIELD)
      || id
    ).trim();
    models.push({ id, name });
  }

  return models;
}

/**
 * agent.api5.cursor.sh is HTTP/2-only; Node fetch/undici cannot speak h2.
 * Unary GetUsableModels uses an unframed protobuf body (application/proto).
 * Optional HTTP/SOCKS proxy is applied via CONNECT tunnel + ALPN h2.
 */
function http2PostProto(url, headers, body, signal, timeoutMs, proxyOptions = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const proxyUrl = resolveOutboundProxyUrl(url, proxyOptions);
    let settled = false;
    let client = null;
    let timeoutId = null;

    const finish = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try { client?.close(); } catch {}
      fn(...args);
    };

    const fail = finish(reject);
    const succeed = finish(resolve);

    timeoutId = setTimeout(() => fail(new Error("Cursor GetUsableModels timed out")), timeoutMs);

    connectHttp2(url, { proxyUrl, timeoutMs })
      .then((session) => {
        if (settled) {
          try { session.close(); } catch {}
          return;
        }
        client = session;
        client.on("error", fail);

        const req = client.request({
          ":method": "POST",
          ":path": urlObj.pathname,
          ":authority": urlObj.host,
          ":scheme": "https",
          ...headers,
        });

        const chunks = [];
        let responseHeaders = {};
        req.on("response", (hdrs) => { responseHeaders = hdrs; });
        req.on("data", (chunk) => { chunks.push(chunk); });
        req.on("end", () => {
          succeed({
            status: Number(responseHeaders[":status"] || 0),
            body: Buffer.concat(chunks),
          });
        });
        req.on("error", fail);

        if (signal) {
          const onAbort = () => fail(new Error("Request aborted"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        req.end(body && body.length ? Buffer.from(body) : undefined);
      })
      .catch(fail);
  });
}

async function fetchCursorCatalog(credentials, signal, options = {}) {
  const accessToken = credentials?.accessToken;
  const machineId = credentials?.providerSpecificData?.machineId;
  const url = getCursorModelsUrl();
  if (!accessToken || !machineId || !url) return null;

  const headers = {
    ...buildCursorHeaders(accessToken, machineId, credentials?.providerSpecificData?.ghostMode !== false),
    // Connect unary calls use an unframed protobuf body, unlike Cursor chat's
    // streaming `application/connect+proto` endpoint.
    accept: "application/proto",
    "content-type": "application/proto",
  };
  delete headers["connect-accept-encoding"];
  delete headers["connect-protocol-version"];

  const body = new Uint8Array();
  let response;
  if (typeof options.http2Post === "function") {
    response = await options.http2Post(url, headers, body, signal);
  } else {
    const proxyUrl = resolveOutboundProxyUrl(url, options.proxyOptions);
    if (proxyUrl) {
      options.log?.info?.("CURSOR_MODELS", `GetUsableModels via HTTP/2 proxy ${maskProxyUrl(proxyUrl)}`);
    }
    response = await http2PostProto(url, headers, body, signal, FETCH_TIMEOUT_MS, options.proxyOptions);
  }
  if (response.status !== 200) {
    const error = new Error(`Cursor GetUsableModels returned ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return parseCursorUsableModels(new Uint8Array(response.body));
}

/**
 * Resolve the live Cursor catalog for the authenticated account.
 * Returns null on any failure so callers can fall back to static models.
 */
export async function resolveCursorModels(credentials, options = {}) {
  if (!credentials?.accessToken || !credentials?.providerSpecificData?.machineId) {
    options.log?.debug?.("CURSOR_MODELS", "No Cursor access token or machine ID; skipping live fetch");
    return null;
  }

  const catalogUrl = getCursorModelsUrl() || "https://agent.api5.cursor.sh/";
  const proxyUrl = resolveOutboundProxyUrl(catalogUrl, options.proxyOptions);
  const key = cacheKey(credentials, proxyUrl);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached?.expiresAt > now) return { models: cached.models };
  }

  try {
    const models = await fetchCursorCatalog(credentials, options.signal, options);
    if (!models?.length) return null;
    catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
    return { models };
  } catch (error) {
    options.log?.warn?.("CURSOR_MODELS", `Live model fetch failed: ${error?.message || error}`);
    return null;
  }
}

export function clearCursorModelCache() {
  catalogCache.clear();
}
