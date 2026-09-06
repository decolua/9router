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
import {
  ZED_WEB_BASE_URL,
  ZED_CLOUD_BASE_URL,
  ZED_LLM_BASE_URL,
  ZED_CLIENT_VERSION,
  ZED_HEADERS,
  ZED_LLM_TOKEN_TTL_MS,
  ZED_MODEL_CACHE_TTL_MS,
  ZED_PRIVATE_KEY_PREFIX,
  ZED_FREE_PLAN_IDS,
  buildZedHostedModelsBlockedMessage,
  buildZedEmptyCatalogMessage,
} from "../config/zedConstants.js";

export {
  ZED_WEB_BASE_URL,
  ZED_CLOUD_BASE_URL,
  ZED_LLM_BASE_URL,
  ZED_HEADERS,
};

const PRIVATE_KEY_PREFIX = ZED_PRIVATE_KEY_PREFIX;
const LLM_TOKEN_TTL_MS = ZED_LLM_TOKEN_TTL_MS;
const MODEL_CACHE_TTL_MS = ZED_MODEL_CACHE_TTL_MS;

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
    let url = null;
    // Absolute URL
    try {
      url = new URL(raw);
    } catch {
      /* continue */
    }
    // Path + query from the local proxy: "/?user_id=…&access_token=…" or "/callback?…"
    if (!url && raw.startsWith("/")) {
      try {
        url = new URL(raw, "http://127.0.0.1");
      } catch {
        /* continue */
      }
    }
    // Bare query: "?user_id=…" or "user_id=…"
    if (!url) {
      try {
        const q = raw.startsWith("?") ? raw : `?${raw}`;
        url = new URL(`http://127.0.0.1/${q}`);
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
          [ZED_HEADERS.version]: ZED_CLIENT_VERSION,
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

    let planInfo = null;
    let warning = null;
    if (models.length === 0) {
      // Empty catalog is usually a plan gate (Zed Free has no hosted models), not a parse bug.
      try {
        const userInfo = await fetchZedAuthenticatedUser(credentials, options);
        const webBaseUrl = options.config?.webBaseUrl || ZED_WEB_BASE_URL;
        planInfo = summarizeZedPlan(userInfo, { webBaseUrl });
        warning = planInfo?.blocksHostedModels
          ? planInfo.message
          : buildZedEmptyCatalogMessage();
      } catch {
        warning = buildZedEmptyCatalogMessage();
      }
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
      planInfo,
      warning,
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

/**
 * Explain why Zed's /models catalog is empty (plan/trial/quota).
 * Token-based plans (student/pro) may report model_requests.limit=0 while still
 * listing models — that alone is NOT "free plan blocked".
 */
export function summarizeZedPlan(userInfo, options = {}) {
  const plan = userInfo?.plan || {};
  const planId = plan.plan_v3 || plan.plan_v2 || plan.plan || null;
  const limit = plan.usage?.model_requests?.limit;
  const modelLimit =
    typeof limit?.limited === "number"
      ? limit.limited
      : typeof limit?.Limited === "number"
        ? limit.Limited
        : limit === "unlimited" || limit?.unlimited
          ? Infinity
          : null;
  const trialStarted = !!plan.trial_started_at;
  const isFree = !planId || ZED_FREE_PLAN_IDS.has(String(planId));
  // Only treat classic free plans as hard-blocked for catalog purposes.
  const blocksHostedModels = isFree;
  const webBaseUrl = options.webBaseUrl || ZED_WEB_BASE_URL;

  return {
    planId,
    modelRequestLimit: modelLimit,
    trialStarted,
    isFree,
    blocksHostedModels,
    message: blocksHostedModels ? buildZedHostedModelsBlockedMessage(webBaseUrl) : null,
  };
}

export function clearZedCaches() {
  llmTokenCache.clear();
  modelCache.clear();
  modelInflight.clear();
}
