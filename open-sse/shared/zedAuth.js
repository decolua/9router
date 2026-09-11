// Zed hosted LLM aggregator — auth + model-catalog helpers.
//
// Zed's cloud (cloud.zed.dev) authenticates native apps with a self-generated RSA
// keypair instead of a registered OAuth client_id/secret:
//   1. Client generates an ephemeral RSA keypair.
//   2. Sends the public key to zed.dev/native_app_signin.
//   3. User signs in via browser; Zed redirects to a local callback with the
//      access token RSA-encrypted against the public key.
//   4. Client decrypts locally with the private key that never left the host.
// No embedded client_id/secret — the credential is a per-login keypair.

import crypto from "node:crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

export const ZED_WEB_BASE_URL = "https://zed.dev";
export const ZED_CLOUD_BASE_URL = "https://cloud.zed.dev";
export const ZED_LLM_BASE_URL = "https://cloud.zed.dev";

export const ZED_HEADERS = {
  expiredToken: "x-zed-expired-token",
  outdatedToken: "x-zed-outdated-token",
  clientSupportsStatus: "x-zed-client-supports-status-messages",
  clientSupportsStreamEnded:
    "x-zed-client-supports-stream-ended-request-completion-status",
  serverSupportsStatus: "x-zed-server-supports-status-messages",
  clientSupportsXai: "x-zed-client-supports-x-ai",
  systemId: "x-zed-system-id",
};

const PRIVATE_KEY_PREFIX = "zed-rsa-pkcs1:";
const LLM_TOKEN_TTL_MS = 50 * 60 * 1000;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

const llmTokenCache = new Map();
const modelCache = new Map();
const modelInflight = new Map();

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function b64urlPadded(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function normalizeBaseUrl(baseUrl, fallback) {
  return String(baseUrl || fallback).replace(/\/+$/, "");
}

function zedUrl(config, key, path, fallbackBase) {
  const base = normalizeBaseUrl(config?.[key], fallbackBase);
  return `${base}${path}`;
}

/** Encode a PEM private key as an opaque verifier (flows through the OAuth codeVerifier slot). */
export function encodeZedPrivateKeyVerifier(privateKeyPem) {
  return `${PRIVATE_KEY_PREFIX}${b64url(privateKeyPem)}`;
}

export function decodeZedPrivateKeyVerifier(verifier) {
  const value = String(verifier || "");
  if (!value.startsWith(PRIVATE_KEY_PREFIX)) {
    throw new Error("Missing Zed private key verifier; restart the login flow");
  }
  return fromB64url(value.slice(PRIVATE_KEY_PREFIX.length));
}

/** Generate a fresh RSA keypair + the zed.dev native_app_signin URL for it. */
export function createZedNativeAuthData(config = {}, options = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "pkcs1", format: "der" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  const nativeAppPort = Number(
    options.nativeAppPort || config.defaultNativeAppPort || 58443,
  );
  const systemId = options.systemId || crypto.randomUUID();
  const publicKeyString = b64urlPadded(publicKey);
  const signInUrl = new URL(
    `${normalizeBaseUrl(config.webBaseUrl, ZED_WEB_BASE_URL)}/native_app_signin`,
  );
  signInUrl.searchParams.set("native_app_port", String(nativeAppPort));
  signInUrl.searchParams.set("native_app_public_key", publicKeyString);
  if (systemId) signInUrl.searchParams.set("system_id", systemId);

  return {
    authUrl: signInUrl.toString(),
    privateKeyVerifier: encodeZedPrivateKeyVerifier(privateKey),
    nativeAppPort,
    systemId,
    publicKey: publicKeyString,
  };
}

/** Parse the pasted native-app callback URL/JSON/query into userId + encrypted token. */
export function parseZedCallbackPayload(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Missing Zed callback URL");

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    let url;
    try {
      url = new URL(raw);
    } catch {
      try {
        url = new URL(`http://127.0.0.1/?${raw.replace(/^\?/, "")}`);
      } catch {
        throw new Error("Invalid Zed callback URL");
      }
    }
    url.searchParams.forEach((value, key) => {
      data[key] = value;
    });
  }

  const userId = data.user_id || data.userId;
  const encryptedAccessToken = data.access_token || data.accessToken || data.token;
  if (!userId || !encryptedAccessToken) {
    throw new Error("Zed callback must include user_id and access_token");
  }
  return { userId: String(userId), encryptedAccessToken: String(encryptedAccessToken) };
}

/** Decrypt the RSA-encrypted access token using the stored private key. */
export function decryptZedAccessToken(encryptedAccessToken, privateKeyVerifier) {
  const privateKey = decodeZedPrivateKeyVerifier(privateKeyVerifier);
  const encrypted = Buffer.from(String(encryptedAccessToken), "base64url");
  try {
    return crypto
      .privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
        encrypted,
      )
      .toString("utf8");
  } catch (oaepError) {
    try {
      return crypto
        .privateDecrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          encrypted,
        )
        .toString("utf8");
    } catch {
      const message = oaepError instanceof Error ? oaepError.message : String(oaepError);
      throw new Error(`Failed to decrypt Zed access token: ${message}`);
    }
  }
}

export function buildZedUserAuthHeader(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const userId = psd.userId || credentials?.userId;
  const accessToken = credentials?.accessToken || credentials?.apiKey;
  if (!userId || !accessToken) {
    throw new Error("Zed credential is missing userId or accessToken");
  }
  return `${userId} ${accessToken}`;
}

function getSystemId(credentials) {
  return String(
    credentials?.providerSpecificData?.systemId || credentials?.systemId || "",
  );
}

async function fetchJson(url, options, proxyOptions = null) {
  const res = await proxyAwareFetch(url, options, proxyOptions);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const message =
      data?.message || data?.error?.message || data?.error || text || `HTTP ${res.status}`;
    const err = new Error(String(message));
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export async function fetchZedAuthenticatedUser(credentials, options = {}) {
  const config = options.config || {};
  const headers = {
    Accept: "application/json",
    Authorization: buildZedUserAuthHeader(credentials),
  };
  const systemId = getSystemId(credentials);
  if (systemId) headers[ZED_HEADERS.systemId] = systemId;

  return fetchJson(
    zedUrl(config, "cloudBaseUrl", "/client/users/me", ZED_CLOUD_BASE_URL),
    {
      method: "GET",
      headers,
      signal: options.signal ?? undefined,
    },
    options.proxyOptions ?? null,
  );
}

function normalizeOrganizationId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if (typeof value[0] === "string") return value[0];
    if (typeof value.id === "string") return value.id;
  }
  return String(value);
}

export function resolveZedOrganizationId(credentials, userInfo = null) {
  const psd = credentials?.providerSpecificData || {};
  const explicit = normalizeOrganizationId(psd.organizationId || psd.defaultOrganizationId);
  if (explicit) return explicit;
  const fromUser = normalizeOrganizationId(
    userInfo?.default_organization_id || userInfo?.defaultOrganizationId,
  );
  if (fromUser) return fromUser;
  const orgs = userInfo?.organizations || [];
  const org = orgs.find((item) => item?.is_personal) || orgs[0];
  return normalizeOrganizationId(org?.id);
}

function zedUserCacheKey(credentials, organizationId) {
  const psd = credentials?.providerSpecificData || {};
  const userId = psd.userId || credentials?.userId || "unknown";
  const token = credentials?.accessToken || credentials?.apiKey || "";
  return `${userId}:${organizationId || "default"}:${token.slice(-16)}`;
}

function zedModelCacheKey(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const org = psd.organizationId || psd.defaultOrganizationId || "default";
  const token = credentials?.accessToken || credentials?.apiKey || "";
  return `${psd.userId || "unknown"}:${org}:${token.slice(-16)}`;
}

export async function fetchZedLlmToken(credentials, options = {}) {
  const config = options.config || {};
  let organizationId = options.organizationId || resolveZedOrganizationId(credentials);
  if (!organizationId) {
    const userInfo = await fetchZedAuthenticatedUser(credentials, options);
    organizationId = resolveZedOrganizationId(credentials, userInfo);
  }
  if (!organizationId) throw new Error("No Zed organization selected");

  const cacheKey = zedUserCacheKey(credentials, organizationId);
  const cached = llmTokenCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: buildZedUserAuthHeader(credentials),
  };
  const systemId = getSystemId(credentials);
  if (systemId) headers[ZED_HEADERS.systemId] = systemId;

  const data = await fetchJson(
    zedUrl(config, "cloudBaseUrl", "/client/llm_tokens", ZED_CLOUD_BASE_URL),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ organization_id: organizationId }),
      signal: options.signal ?? undefined,
    },
  );
  const token =
    typeof data?.token === "string" ? data.token : data?.token?.[0] || data?.token?.value;
  if (!token) throw new Error("Zed did not return an LLM token");
  llmTokenCache.set(cacheKey, { token, expiresAt: Date.now() + LLM_TOKEN_TTL_MS });
  return token;
}

export function shouldRefreshZedLlmToken(response) {
  return (
    response?.status === 401 ||
    !!response?.headers?.has?.(ZED_HEADERS.expiredToken) ||
    !!response?.headers?.has?.(ZED_HEADERS.outdatedToken)
  );
}

export async function zedLlmFetch(credentials, path, options = {}) {
  const config = options.config || {};
  const url = zedUrl(config, "llmBaseUrl", path, ZED_LLM_BASE_URL);
  const buildRequest = async (forceRefresh) => {
    const token = await fetchZedLlmToken(credentials, { ...options, forceRefresh });
    return proxyAwareFetch(url, {
      ...options.fetchOptions,
      headers: {
        ...(options.fetchOptions?.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      signal: options.signal ?? undefined,
    });
  };

  let response = await buildRequest(false);
  if (shouldRefreshZedLlmToken(response)) {
    response = await buildRequest(true);
  }
  return response;
}

function normalizeZedModelId(id) {
  if (!id) return "";
  if (typeof id === "string") return id;
  if (typeof id === "object" && id !== null) {
    if (typeof id[0] === "string") return id[0];
    if (typeof id.id === "string") return id.id;
  }
  return String(id);
}

export function mapZedModel(model) {
  const id = normalizeZedModelId(model?.id);
  if (!id) return null;
  return {
    id,
    name: model.display_name || model.displayName || id,
    provider: model.provider,
    isLatest: !!model.is_latest,
    contextLength: model.max_token_count ?? model.maxTokenCount,
    contextLengthInMaxMode: model.max_token_count_in_max_mode ?? model.maxTokenCountInMaxMode,
    maxOutputTokens: model.max_output_tokens ?? model.maxOutputTokens,
    supportsTools: !!model.supports_tools,
    supportsImages: !!model.supports_images,
    supportsThinking: !!model.supports_thinking,
    supportsDisablingThinking: !!model.supports_disabling_thinking,
    supportsFastMode: !!model.supports_fast_mode,
    supportsServerSideCompaction: !!model.supports_server_side_compaction,
    supportedEffortLevels: model.supported_effort_levels ?? model.supportedEffortLevels ?? [],
    supportsStreamingTools: !!model.supports_streaming_tools,
    supportsParallelToolCalls: !!model.supports_parallel_tool_calls,
    isDisabled: !!model.is_disabled,
    disabledReason: model.disabled_reason ?? null,
  };
}

/** Resolve (and cache) the live Zed model catalog. Never hardcoded — always a live fetch. */
export async function resolveZedModels(credentials, options = {}) {
  if (!credentials?.accessToken) return null;
  const key = zedModelCacheKey(credentials);
  const cached = modelCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached;

  const existing = modelInflight.get(key);
  if (existing && !options.forceRefresh) return existing;

  const promise = (async () => {
    const response = await zedLlmFetch(credentials, "/models", {
      ...options,
      fetchOptions: {
        method: "GET",
        headers: {
          Accept: "application/json",
          [ZED_HEADERS.clientSupportsXai]: "true",
        },
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Zed models failed: ${response.status} ${text}`);
    }
    const data = await response.json();
    const rawModels = Array.isArray(data?.models) ? data.models : [];
    const models = rawModels
      .map(mapZedModel)
      .filter(Boolean)
      .filter((model) => !model.isDisabled);
    const rawById = new Map();
    for (const raw of rawModels) {
      const id = normalizeZedModelId(raw?.id);
      if (id) rawById.set(id, raw);
    }
    const entry = {
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      models,
      rawModels,
      rawById,
      defaultModel: normalizeZedModelId(data?.default_model ?? data?.defaultModel),
      defaultFastModel: normalizeZedModelId(data?.default_fast_model ?? data?.defaultFastModel),
      recommendedModels: (data?.recommended_models || data?.recommendedModels || [])
        .map(normalizeZedModelId)
        .filter(Boolean),
    };
    modelCache.set(key, entry);
    return entry;
  })();

  modelInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (modelInflight.get(key) === promise) modelInflight.delete(key);
  }
}

export function clearZedCaches() {
  llmTokenCache.clear();
  modelCache.clear();
  modelInflight.clear();
}
