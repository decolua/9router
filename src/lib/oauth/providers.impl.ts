// providers.impl.ts — OAuth provider configurations and handlers (TypeScript implementation)
import "open-sse/index.js";
import crypto from "crypto";

import type { OAuthConfig } from "open-sse/types/provider.js";
import type { JsonValue } from "open-sse/types/executor.js";

import { generatePKCE } from "./utils/pkce";
import {
  CLAUDE_CONFIG, CODEX_CONFIG, GEMINI_CONFIG, QWEN_CONFIG, QODER_CONFIG,
  IFLOW_CONFIG, ANTIGRAVITY_CONFIG, GITHUB_CONFIG, KIRO_CONFIG,
  assertValidAwsRegion, CURSOR_CONFIG, KIMI_CODING_CONFIG, KILOCODE_CONFIG,
  CLINE_CONFIG, GITLAB_CONFIG, CODEBUDDY_CONFIG, getOAuthClientMetadata,
} from "./constants/oauth";
import { XAI_CONFIG, XAI_PKCE_VERIFIER_BYTES } from "./constants/xai";
import {
  validateXaiOAuthEndpoint, decodeXaiIdTokenEmail,
  extractEmailFromAccessToken, extractCodexAccountInfo, fetchKiroProfileArn,
} from "./providerHelpers";

export { extractCodexAccountInfo, fetchKiroProfileArn };

// ---------------------------------------------------------------------------
// ProviderConfig — local type for the PROVIDERS map entries
// ---------------------------------------------------------------------------

export interface MappedTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope?: string;
  email?: string;
  displayName?: string | null;
  apiKey?: string;
  idToken?: string;
  lastRefreshAt?: string;
  projectId?: string;
  providerSpecificData?: Record<string, JsonValue | null | undefined>;
}

interface ProviderConfig {
  config: OAuthConfig & Record<string, JsonValue | undefined>;
  flowType: "authorization_code_pkce" | "authorization_code" | "device_code" | "import_token";
  fixedPort?: number;
  callbackPath?: string;
  pkceVerifierBytes?: number;
  prepareConfig?: (config: ProviderConfig["config"], meta: Record<string, JsonValue>) => Promise<ProviderConfig["config"]>;
  buildAuthUrl?: (config: ProviderConfig["config"], redirectUri: string, state: string, codeChallenge: string | undefined, meta?: Record<string, JsonValue>) => string;
  exchangeToken?: (config: ProviderConfig["config"], code: string, redirectUri: string, codeVerifier: string, state: string, meta?: Record<string, JsonValue>) => Promise<Record<string, JsonValue>>;
  postExchange?: (tokens: Record<string, JsonValue>) => Promise<Record<string, JsonValue>>;
  mapTokens: (tokens: Record<string, JsonValue>, extra?: Record<string, JsonValue> | null) => MappedTokens;
  requestDeviceCode?: (config: ProviderConfig["config"], codeChallenge: string, options?: Record<string, JsonValue>) => Promise<Record<string, JsonValue>>;
  pollToken?: (config: ProviderConfig["config"], deviceCode: string, codeVerifier: string, extraData?: Record<string, JsonValue>) => Promise<{ ok: boolean; data: Record<string, JsonValue> }>;
}

// ---------------------------------------------------------------------------
// Inlined xAI discovery (keep web route bundle free of `open` CLI package)
// ---------------------------------------------------------------------------

let cachedXaiDiscovery: { authorizeUrl: string; tokenUrl: string } | null = null;

async function discoverXaiEndpoints() {
  if (cachedXaiDiscovery) return cachedXaiDiscovery;
  try {
    const res = await fetch(String(XAI_CONFIG.discoveryUrl ?? ""), { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json() as Record<string, JsonValue>;
      cachedXaiDiscovery = {
        authorizeUrl: validateXaiOAuthEndpoint(String(data["authorization_endpoint"] ?? ""), "authorization_endpoint"),
        tokenUrl: validateXaiOAuthEndpoint(String(data["token_endpoint"] ?? ""), "token_endpoint"),
      };
      return cachedXaiDiscovery;
    }
  } catch { /* fall through to static fallback */ }
  cachedXaiDiscovery = { authorizeUrl: String(XAI_CONFIG.authorizeUrl ?? ""), tokenUrl: String(XAI_CONFIG.tokenUrl ?? "") };
  return cachedXaiDiscovery;
}

// ---------------------------------------------------------------------------
// PROVIDERS map (filled in phases 2–3)
// ---------------------------------------------------------------------------

export const PROVIDERS: Record<string, ProviderConfig> = {
  claude: {
    config: CLAUDE_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params = new URLSearchParams({
        code: "true",
        client_id: String(config.clientId ?? ""),
        response_type: "code",
        redirect_uri: redirectUri,
        scope: (config.scopes ?? []).join(" "),
        code_challenge: codeChallenge ?? "",
        code_challenge_method: String(config.codeChallengeMethod ?? ""),
        state,
      });
      return `${String(config.authorizeUrl ?? "")}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, state) => {
      let authCode = code;
      let codeState = "";
      if (authCode.includes("#")) {
        const parts = authCode.split("#");
        authCode = parts[0] ?? "";
        codeState = parts[1] ?? "";
      }
      const response = await fetch(String(config.tokenUrl ?? ""), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          code: authCode,
          state: codeState || state,
          grant_type: "authorization_code",
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
        }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    mapTokens: (tokens) => ({
      accessToken: String(tokens["access_token"] ?? ""),
      refreshToken: String(tokens["refresh_token"] ?? ""),
      expiresIn: Number(tokens["expires_in"] ?? 0),
      scope: String(tokens["scope"] ?? ""),
    }),
  },

  codex: {
    config: CODEX_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: Number(CODEX_CONFIG.fixedPort ?? 0),
    callbackPath: String(CODEX_CONFIG.callbackPath ?? "/callback"),
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const params: Record<string, string> = {
        response_type: "code",
        client_id: String(config.clientId ?? ""),
        redirect_uri: redirectUri,
        scope: String(config.scope ?? ""),
        code_challenge: codeChallenge ?? "",
        code_challenge_method: String(config.codeChallengeMethod ?? ""),
        ...(config.extraParams ?? {}),
        state,
      };
      const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
      return `${String(config.authorizeUrl ?? "")}?${qs}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier) => {
      const response = await fetch(String(config.tokenUrl ?? ""), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: String(config.clientId ?? ""), code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    mapTokens: (tokens) => {
      const info = extractCodexAccountInfo(String(tokens["id_token"] ?? ""));
      const mapped: MappedTokens = {
        accessToken: String(tokens["access_token"] ?? ""),
        refreshToken: String(tokens["refresh_token"] ?? ""),
        expiresIn: Number(tokens["expires_in"] ?? 0),
        idToken: String(tokens["id_token"] ?? ""),
        lastRefreshAt: new Date().toISOString(),
      };
      const email = info.email ?? extractEmailFromAccessToken(String(tokens["access_token"] ?? ""));
      if (email) mapped.email = email;
      if (info.chatgptAccountId ?? info.chatgptPlanType) {
        mapped.providerSpecificData = { chatgptAccountId: info.chatgptAccountId ?? null, chatgptPlanType: info.chatgptPlanType ?? null };
      }
      return mapped;
    },
  },

  xai: {
    config: XAI_CONFIG,
    flowType: "authorization_code_pkce",
    fixedPort: Number(XAI_CONFIG.loopbackPort ?? 0),
    callbackPath: String(XAI_CONFIG.callbackPath ?? "/callback"),
    pkceVerifierBytes: XAI_PKCE_VERIFIER_BYTES,
    prepareConfig: async (config) => {
      const endpoints = await discoverXaiEndpoints();
      return { ...config, authorizeUrl: endpoints.authorizeUrl, tokenUrl: endpoints.tokenUrl };
    },
    buildAuthUrl: (config, redirectUri, state, codeChallenge) => {
      const nonce = crypto.randomBytes(16).toString("hex");
      const params: Record<string, string> = {
        response_type: "code", client_id: String(config.clientId ?? ""), redirect_uri: redirectUri,
        scope: String(config.scope ?? ""), code_challenge: codeChallenge ?? "",
        code_challenge_method: String(config.codeChallengeMethod ?? ""),
        state, nonce, plan: "generic", referrer: "cli-proxy-api",
      };
      const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
      return `${String(config.authorizeUrl ?? "")}?${qs}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier) => {
      const response = await fetch(String(config.tokenUrl ?? ""), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: String(config.clientId ?? ""), code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
      });
      if (!response.ok) throw new Error(`xAI token exchange failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    mapTokens: (tokens) => {
      const mapped: MappedTokens = {
        accessToken: String(tokens["access_token"] ?? ""),
        refreshToken: String(tokens["refresh_token"] ?? ""),
        expiresIn: Number(tokens["expires_in"] ?? 0),
        scope: String(tokens["scope"] ?? ""),
      };
      const email = decodeXaiIdTokenEmail(String(tokens["id_token"] ?? ""));
      if (email) mapped.email = email;
      if (tokens["id_token"]) mapped.providerSpecificData = { idToken: String(tokens["id_token"]) };
      return mapped;
    },
  },

  "gemini-cli": {
    config: GEMINI_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({
        client_id: String(config.clientId ?? ""),
        response_type: "code",
        redirect_uri: redirectUri,
        scope: (config.scopes ?? []).join(" "),
        state,
        access_type: "offline",
        prompt: "consent",
      });
      return `${String(config.authorizeUrl ?? "")}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      const response = await fetch(String(config.tokenUrl ?? ""), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: String(config.clientId ?? ""), client_secret: String(config.clientSecret ?? ""), code, redirect_uri: redirectUri }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    postExchange: async (tokens) => {
      const userInfoRes = await fetch(`${GEMINI_CONFIG.userInfoUrl}?alt=json`, { headers: { Authorization: `Bearer ${String(tokens["access_token"] ?? "")}` } });
      const userInfo = userInfoRes.ok ? await userInfoRes.json() as Record<string, JsonValue> : {};
      let projectId = "";
      try {
        const projectRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
          method: "POST",
          headers: { Authorization: `Bearer ${String(tokens["access_token"] ?? "")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: getOAuthClientMetadata(), mode: 1 }),
        });
        if (projectRes.ok) {
          const data = await projectRes.json() as Record<string, JsonValue>;
          const proj = data["cloudaicompanionProject"];
          projectId = (proj != null && typeof proj === "object" && !Array.isArray(proj)) ? String((proj as Record<string, JsonValue>)["id"] ?? "") : String(proj ?? "");
        }
      } catch (e) { console.log("Failed to fetch project ID:", e); }
      return { userInfo, projectId } as Record<string, JsonValue>;
    },
    mapTokens: (tokens, extra) => ({
      accessToken: String(tokens["access_token"] ?? ""),
      refreshToken: String(tokens["refresh_token"] ?? ""),
      expiresIn: Number(tokens["expires_in"] ?? 0),
      scope: String(tokens["scope"] ?? ""),
      email: String((extra?.["userInfo"] as Record<string, JsonValue> | undefined)?.["email"] ?? ""),
      projectId: String(extra?.["projectId"] ?? ""),
    }),
  },

  antigravity: {
    config: ANTIGRAVITY_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const params = new URLSearchParams({ client_id: String(config.clientId ?? ""), response_type: "code", redirect_uri: redirectUri, scope: (config.scopes ?? []).join(" "), state, access_type: "offline", prompt: "consent" });
      return `${String(config.authorizeUrl ?? "")}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      const response = await fetch(String(config.tokenUrl ?? ""), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: String(config.clientId ?? ""), client_secret: String(config.clientSecret ?? ""), code, redirect_uri: redirectUri }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    postExchange: async (tokens) => {
      const loadHeaders: Record<string, string> = {
        "Authorization": `Bearer ${String(tokens["access_token"] ?? "")}`, "Content-Type": "application/json",
        "User-Agent": String(ANTIGRAVITY_CONFIG.loadCodeAssistUserAgent ?? ""),
        "X-Goog-Api-Client": String(ANTIGRAVITY_CONFIG.loadCodeAssistApiClient ?? ""),
        "Client-Metadata": String(ANTIGRAVITY_CONFIG.loadCodeAssistClientMetadata ?? ""),
        "x-request-source": "local",
      };
      const metadata = getOAuthClientMetadata();
      const userInfoRes = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, { headers: { Authorization: `Bearer ${String(tokens["access_token"] ?? "")}`, "x-request-source": "local" } });
      const userInfo = userInfoRes.ok ? await userInfoRes.json() as Record<string, JsonValue> : {};
      let projectId = "";
      let tierId = "legacy-tier";
      try {
        const loadRes = await fetch(String(ANTIGRAVITY_CONFIG.loadCodeAssistEndpoint ?? ""), { method: "POST", headers: loadHeaders, body: JSON.stringify({ metadata }) });
        if (loadRes.ok) {
          const data = await loadRes.json() as Record<string, JsonValue>;
          const proj = data["cloudaicompanionProject"];
          projectId = (proj != null && typeof proj === "object" && !Array.isArray(proj)) ? String((proj as Record<string, JsonValue>)["id"] ?? "") : String(proj ?? "");
          const tiers = data["allowedTiers"];
          if (Array.isArray(tiers)) {
            for (const tier of tiers as Record<string, JsonValue>[]) {
              if (tier["isDefault"] && tier["id"]) { tierId = String(tier["id"]).trim(); break; }
            }
          }
        }
      } catch (e) { console.log("Failed to load code assist:", e); }
      if (projectId) {
        const doOnboard = async () => {
          for (let i = 0; i < 10; i++) {
            try {
              const r = await fetch(String(ANTIGRAVITY_CONFIG.onboardUserEndpoint ?? ""), { method: "POST", headers: loadHeaders, body: JSON.stringify({ tierId, metadata }) });
              if (r.ok) { const result = await r.json() as Record<string, JsonValue>; if (result["done"] === true) break; }
            } catch { break; }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        };
        doOnboard().catch(() => {});
      }
      return { userInfo, projectId } as Record<string, JsonValue>;
    },
    mapTokens: (tokens, extra) => ({
      accessToken: String(tokens["access_token"] ?? ""),
      refreshToken: String(tokens["refresh_token"] ?? ""),
      expiresIn: Number(tokens["expires_in"] ?? 0),
      scope: String(tokens["scope"] ?? ""),
      email: String((extra?.["userInfo"] as Record<string, JsonValue> | undefined)?.["email"] ?? ""),
      projectId: String(extra?.["projectId"] ?? ""),
    }),
  },

  iflow: {
    config: IFLOW_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri, state) => {
      const extra = config.extraParams ?? {};
      const params = new URLSearchParams({ loginMethod: String(extra["loginMethod"] ?? ""), type: String(extra["type"] ?? ""), redirect: redirectUri, state, client_id: String(config.clientId ?? "") });
      return `${String(config.authorizeUrl ?? "")}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      const basicAuth = Buffer.from(`${String(config.clientId ?? "")}:${String(config.clientSecret ?? "")}`).toString("base64");
      const response = await fetch(String(config.tokenUrl ?? ""), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: String(config.clientId ?? ""), client_secret: String(config.clientSecret ?? "") }),
      });
      if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    postExchange: async (tokens) => {
      const userInfoRes = await fetch(`${IFLOW_CONFIG.userInfoUrl}?accessToken=${encodeURIComponent(String(tokens["access_token"] ?? ""))}`, { headers: { Accept: "application/json" } });
      if (!userInfoRes.ok) throw new Error(`Failed to fetch user info: ${await userInfoRes.text()}`);
      const result = await userInfoRes.json() as Record<string, JsonValue>;
      if (!result["success"]) throw new Error(`User info request failed: ${String(result["message"] ?? "Unknown error")}`);
      const userInfo = (result["data"] as Record<string, JsonValue> | null | undefined) ?? {};
      const apiKey = String(userInfo["apiKey"] ?? "").trim();
      if (!apiKey) throw new Error("Empty API key returned from iFlow");
      const email = String(userInfo["email"] ?? "").trim() || String(userInfo["phone"] ?? "").trim();
      if (!email) throw new Error("Missing account email/phone in user info");
      return { userInfo } as Record<string, JsonValue>;
    },
    mapTokens: (tokens, extra) => {
      const userInfo = (extra?.["userInfo"] as Record<string, JsonValue> | undefined) ?? {};
      return {
        accessToken: String(tokens["access_token"] ?? ""),
        refreshToken: String(tokens["refresh_token"] ?? ""),
        expiresIn: Number(tokens["expires_in"] ?? 0),
        apiKey: String(userInfo["apiKey"] ?? ""),
        email: String(userInfo["email"] ?? userInfo["phone"] ?? ""),
        displayName: String(userInfo["nickname"] ?? userInfo["name"] ?? "") || null,
      };
    },
  },

  qoder: {
    config: QODER_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const { QoderService } = await import("@/lib/oauth/services/qoder");
      const flow = new QoderService().initiateDeviceFlow();
      return { device_code: flow.nonce, user_code: flow.nonce.slice(0, 8).toUpperCase(), verification_uri: String(config.loginUrl ?? ""), verification_uri_complete: flow.verificationUriComplete, expires_in: 300, interval: 2, codeVerifier: flow.codeVerifier, _qoderNonce: flow.nonce, _qoderMachineId: flow.machineId } as Record<string, JsonValue>;
    },
    pollToken: async (_config, deviceCode, codeVerifier, extraData) => {
      const { QoderService } = await import("@/lib/oauth/services/qoder");
      const svc = new QoderService();
      const nonce = deviceCode || String(extraData?.["_qoderNonce"] ?? "");
      const verifier = codeVerifier || String(extraData?.["_qoderVerifier"] ?? "");
      if (!nonce || !verifier) return { ok: false, data: { error: "invalid_request", error_description: "Missing nonce/verifier" } };
      let result;
      try { result = await svc.pollDeviceToken({ nonce, codeVerifier: verifier }); }
      catch (err) { return { ok: false, data: { error: "poll_failed", error_description: (err as Error).message } }; }
      if (result.status === "pending") return { ok: false, data: { error: "authorization_pending" } };
      const userInfo = await svc.fetchUserInfo(result.accessToken);
      const minSeconds = 24 * 60 * 60;
      const remainingSeconds = Math.floor(((result.expireTime ?? Date.now()) - Date.now()) / 1000);
      const expiresIn = Math.max(minSeconds, remainingSeconds);
      return { ok: true, data: { access_token: result.accessToken, refresh_token: result.refreshToken, expires_in: expiresIn, _qoderUserId: result.userId, _qoderMachineId: String(extraData?.["_qoderMachineId"] ?? ""), _qoderName: userInfo.name, _qoderEmail: userInfo.email, _qoderOrganizationId: userInfo.organizationId } };
    },
    mapTokens: (tokens) => {
      const rawEmail = String(tokens["_qoderEmail"] ?? "").trim();
      const displayName = String(tokens["_qoderName"] ?? "").trim() || null;
      const userId = String(tokens["_qoderUserId"] ?? "");
      const email = rawEmail || (userId ? `qoder-user-${userId}` : undefined);
      return { accessToken: String(tokens["access_token"] ?? ""), refreshToken: String(tokens["refresh_token"] ?? "") || null, expiresIn: Number(tokens["expires_in"] ?? 0), ...(email !== undefined ? { email } : {}), displayName, providerSpecificData: { authMethod: "device", userId, machineId: String(tokens["_qoderMachineId"] ?? ""), organizationId: String(tokens["_qoderOrganizationId"] ?? "") } };
    },
  },

  qwen: {
    config: QWEN_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, codeChallenge) => {
      const response = await fetch(String(config.deviceCodeUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: String(config.clientId ?? ""), scope: String(config.scope ?? ""), code_challenge: codeChallenge, code_challenge_method: String(config.codeChallengeMethod ?? "") }) });
      if (!response.ok) throw new Error(`Device code request failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    pollToken: async (config, deviceCode, codeVerifier) => {
      const response = await fetch(String(config.tokenUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: String(config.clientId ?? ""), device_code: deviceCode, code_verifier: codeVerifier }) });
      return { ok: response.ok, data: await response.json() as Record<string, JsonValue> };
    },
    mapTokens: (tokens) => ({ accessToken: String(tokens["access_token"] ?? ""), refreshToken: String(tokens["refresh_token"] ?? ""), expiresIn: Number(tokens["expires_in"] ?? 0), providerSpecificData: { resourceUrl: String(tokens["resource_url"] ?? "") } }),
  },

  github: {
    config: GITHUB_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(String(config.deviceCodeUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: String(config.clientId ?? ""), scope: String(config.scopes ?? "") }) });
      if (!response.ok) throw new Error(`Device code request failed: ${await response.text()}`);
      return await response.json() as Record<string, JsonValue>;
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(String(config.tokenUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: String(config.clientId ?? ""), device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
      let data: Record<string, JsonValue>;
      try { data = await response.json() as Record<string, JsonValue>; }
      catch (e) { const text = await response.text(); data = { error: "invalid_response", error_description: text }; }
      return { ok: response.ok, data };
    },
    postExchange: async (tokens) => {
      const headers = { Authorization: `Bearer ${String(tokens["access_token"] ?? "")}`, Accept: "application/json", "X-GitHub-Api-Version": String(GITHUB_CONFIG.apiVersion ?? ""), "User-Agent": String(GITHUB_CONFIG.userAgent ?? "") };
      const copilotRes = await fetch(String(GITHUB_CONFIG.copilotTokenUrl ?? ""), { headers });
      const copilotToken = copilotRes.ok ? await copilotRes.json() as Record<string, JsonValue> : {};
      const userRes = await fetch(String(GITHUB_CONFIG.userInfoUrl ?? ""), { headers });
      const userInfo = userRes.ok ? await userRes.json() as Record<string, JsonValue> : {};
      return { copilotToken, userInfo } as Record<string, JsonValue>;
    },
    mapTokens: (tokens, extra) => ({
      accessToken: String(tokens["access_token"] ?? ""),
      refreshToken: String(tokens["refresh_token"] ?? ""),
      expiresIn: Number(tokens["expires_in"] ?? 0),
      providerSpecificData: {
        copilotToken: String((extra?.["copilotToken"] as Record<string, JsonValue> | undefined)?.["token"] ?? ""),
        copilotTokenExpiresAt: String((extra?.["copilotToken"] as Record<string, JsonValue> | undefined)?.["expires_at"] ?? ""),
        githubUserId: (extra?.["userInfo"] as Record<string, JsonValue> | undefined)?.["id"] ?? null,
        githubLogin: String((extra?.["userInfo"] as Record<string, JsonValue> | undefined)?.["login"] ?? ""),
        githubName: String((extra?.["userInfo"] as Record<string, JsonValue> | undefined)?.["name"] ?? ""),
        githubEmail: String((extra?.["userInfo"] as Record<string, JsonValue> | undefined)?.["email"] ?? ""),
      },
    }),
  },

  kiro: {
    config: KIRO_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config, _cc, options) => {
      const trimmedRegion = typeof options?.["region"] === "string" ? options["region"].trim() : "";
      const region = trimmedRegion || "us-east-1";
      assertValidAwsRegion(region);
      const trimmedStart = typeof options?.["startUrl"] === "string" ? options["startUrl"].trim() : "";
      const startUrl = trimmedStart || String(config.startUrl ?? "");
      const authMethod = options?.["authMethod"] === "idc" ? "idc" : "builder-id";
      const registerClientUrl = `https://oidc.${region}.amazonaws.com/client/register`;
      const deviceAuthUrl = `https://oidc.${region}.amazonaws.com/device_authorization`;
      const registerRes = await fetch(registerClientUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ clientName: config.clientName, clientType: config.clientType, scopes: config.scopes, grantTypes: config.grantTypes, issuerUrl: config.issuerUrl }) });
      if (!registerRes.ok) throw new Error(`Client registration failed: ${await registerRes.text()}`);
      const clientInfo = await registerRes.json() as Record<string, JsonValue>;
      const deviceRes = await fetch(deviceAuthUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ clientId: clientInfo["clientId"], clientSecret: clientInfo["clientSecret"], startUrl }) });
      if (!deviceRes.ok) throw new Error(`Device authorization failed: ${await deviceRes.text()}`);
      const d = await deviceRes.json() as Record<string, JsonValue>;
      return { device_code: d["deviceCode"] ?? null, user_code: d["userCode"] ?? null, verification_uri: d["verificationUri"] ?? null, verification_uri_complete: d["verificationUriComplete"] ?? null, expires_in: d["expiresIn"] ?? null, interval: d["interval"] ?? 5, _clientId: clientInfo["clientId"] ?? null, _clientSecret: clientInfo["clientSecret"] ?? null, _region: region, _authMethod: authMethod, _startUrl: startUrl };
    },
    pollToken: async (_config, deviceCode, _cv, extraData) => {
      const region = String(extraData?.["_region"] ?? "us-east-1");
      assertValidAwsRegion(region);
      const response = await fetch(`https://oidc.${region}.amazonaws.com/token`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ clientId: extraData?.["_clientId"], clientSecret: extraData?.["_clientSecret"], deviceCode, grantType: "urn:ietf:params:oauth:grant-type:device_code" }) });
      let data: Record<string, JsonValue>;
      try { data = await response.json() as Record<string, JsonValue>; }
      catch (e) { const text = await response.text(); data = { error: "invalid_response", error_description: text }; }
      if (data["accessToken"]) {
        return { ok: true, data: { access_token: data["accessToken"], refresh_token: data["refreshToken"] ?? null, expires_in: data["expiresIn"] ?? null, profile_arn: data["profileArn"] ?? null, _clientId: extraData?.["_clientId"] ?? null, _clientSecret: extraData?.["_clientSecret"] ?? null, _region: extraData?.["_region"] ?? null, _authMethod: extraData?.["_authMethod"] ?? null, _startUrl: extraData?.["_startUrl"] ?? null } };
      }
      return { ok: false, data: { error: data["error"] ?? "authorization_pending", error_description: data["error_description"] ?? data["message"] ?? null } };
    },
    mapTokens: (tokens) => {
      const email = extractEmailFromAccessToken(String(tokens["access_token"] ?? ""));
      return { accessToken: String(tokens["access_token"] ?? ""), refreshToken: String(tokens["refresh_token"] ?? ""), expiresIn: Number(tokens["expires_in"] ?? 0), ...(email ? { email } : {}), providerSpecificData: { profileArn: tokens["profile_arn"] ?? null, clientId: String(tokens["_clientId"] ?? ""), clientSecret: String(tokens["_clientSecret"] ?? ""), region: String(tokens["_region"] ?? "us-east-1"), authMethod: String(tokens["_authMethod"] ?? "builder-id"), startUrl: String(tokens["_startUrl"] ?? (KIRO_CONFIG.startUrl ?? "")) } };
    },
  },

  cursor: {
    config: CURSOR_CONFIG,
    flowType: "import_token",
    mapTokens: (tokens) => ({
      accessToken: String(tokens["accessToken"] ?? ""),
      refreshToken: null,
      expiresIn: Number(tokens["expiresIn"] ?? 86400),
      providerSpecificData: { machineId: String(tokens["machineId"] ?? ""), authMethod: "imported" },
    }),
  },

  "kimi-coding": {
    config: KIMI_CODING_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(String(config.deviceCodeUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: String(config.clientId ?? "") }) });
      if (!response.ok) throw new Error(`Device code request failed: ${await response.text()}`);
      const data = await response.json() as Record<string, JsonValue>;
      return { device_code: data["device_code"] ?? null, user_code: data["user_code"] ?? null, verification_uri: data["verification_uri"] ?? "https://www.kimi.com/code/authorize_device", verification_uri_complete: data["verification_uri_complete"] ?? `https://www.kimi.com/code/authorize_device?user_code=${String(data["user_code"] ?? "")}`, expires_in: data["expires_in"] ?? null, interval: data["interval"] ?? 5 };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(String(config.tokenUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: String(config.clientId ?? ""), device_code: deviceCode }) });
      let data: Record<string, JsonValue>;
      try { data = await response.json() as Record<string, JsonValue>; }
      catch (e) { const text = await response.text(); data = { error: "invalid_response", error_description: text }; }
      return { ok: response.ok, data };
    },
    mapTokens: (tokens) => ({ accessToken: String(tokens["access_token"] ?? ""), refreshToken: String(tokens["refresh_token"] ?? ""), expiresIn: Number(tokens["expires_in"] ?? 0) }),
  },

  kilocode: {
    config: KILOCODE_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const response = await fetch(String(config.initiateUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) {
        if (response.status === 429) throw new Error("Too many pending authorization requests. Please try again later.");
        throw new Error(`Device auth initiation failed: ${await response.text()}`);
      }
      const data = await response.json() as Record<string, JsonValue>;
      return { device_code: data["code"] ?? null, user_code: data["code"] ?? null, verification_uri: data["verificationUrl"] ?? null, verification_uri_complete: data["verificationUrl"] ?? null, expires_in: data["expiresIn"] ?? 300, interval: 3 };
    },
    pollToken: async (config, deviceCode) => {
      const response = await fetch(`${String(config.pollUrlBase ?? "")}/${deviceCode}`);
      if (response.status === 202) return { ok: false, data: { error: "authorization_pending" } };
      if (response.status === 403) return { ok: false, data: { error: "access_denied", error_description: "Authorization denied by user" } };
      if (response.status === 410) return { ok: false, data: { error: "expired_token", error_description: "Authorization code expired" } };
      if (!response.ok) return { ok: false, data: { error: "poll_failed", error_description: `Poll failed: ${response.status}` } };
      const data = await response.json() as Record<string, JsonValue>;
      if (data["status"] === "approved" && data["token"]) {
        let orgId: JsonValue = null;
        try {
          const profileRes = await fetch(`${String(config.apiBaseUrl ?? "")}/api/profile`, { headers: { "Authorization": `Bearer ${String(data["token"])}` } });
          if (profileRes.ok) { const profile = await profileRes.json() as Record<string, JsonValue>; const orgs = profile["organizations"]; orgId = Array.isArray(orgs) ? ((orgs[0] as Record<string, JsonValue>)?.["id"] ?? null) : null; }
        } catch {}
        return { ok: true, data: { access_token: data["token"], _userEmail: data["userEmail"] ?? null, _orgId: orgId } };
      }
      return { ok: false, data: { error: "authorization_pending" } };
    },
    mapTokens: (tokens) => ({ accessToken: String(tokens["access_token"] ?? ""), refreshToken: null, expiresIn: null, ...(tokens["_userEmail"] ? { email: String(tokens["_userEmail"]) } : {}), ...(tokens["_orgId"] ? { providerSpecificData: { orgId: tokens["_orgId"] } } : {}) }),
  },

  cline: {
    config: CLINE_CONFIG,
    flowType: "authorization_code",
    buildAuthUrl: (config, redirectUri) => {
      const params = new URLSearchParams({ client_type: "extension", callback_url: redirectUri, redirect_uri: redirectUri });
      return `${String(config.authorizeUrl ?? "")}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri) => {
      try {
        let base64 = code;
        const padding = 4 - (base64.length % 4);
        if (padding !== 4) base64 += "=".repeat(padding);
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const lastBrace = decoded.lastIndexOf("}");
        if (lastBrace === -1) throw new Error("No JSON found in decoded code");
        const tokenData = JSON.parse(decoded.substring(0, lastBrace + 1)) as Record<string, JsonValue>;
        return { access_token: tokenData["accessToken"] ?? null, refresh_token: tokenData["refreshToken"] ?? null, email: tokenData["email"] ?? null, firstName: tokenData["firstName"] ?? null, lastName: tokenData["lastName"] ?? null, expires_at: tokenData["expiresAt"] ?? null };
      } catch {
        const response = await fetch(String(config.tokenExchangeUrl ?? ""), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, client_type: "extension", redirect_uri: redirectUri }) });
        if (!response.ok) throw new Error(`Cline token exchange failed: ${await response.text()}`);
        const data = await response.json() as Record<string, JsonValue>;
        const d = data["data"] as Record<string, JsonValue> | null | undefined;
        return { access_token: d?.["accessToken"] ?? data["accessToken"] ?? null, refresh_token: d?.["refreshToken"] ?? data["refreshToken"] ?? null, email: (d?.["userInfo"] as Record<string, JsonValue> | undefined)?.["email"] ?? "", expires_at: d?.["expiresAt"] ?? data["expiresAt"] ?? null };
      }
    },
    mapTokens: (tokens) => ({
      accessToken: String(tokens["access_token"] ?? ""),
      refreshToken: String(tokens["refresh_token"] ?? ""),
      expiresIn: tokens["expires_at"] ? Math.floor((new Date(String(tokens["expires_at"])).getTime() - Date.now()) / 1000) : 3600,
      email: String(tokens["email"] ?? ""),
      providerSpecificData: { firstName: tokens["firstName"] ?? null, lastName: tokens["lastName"] ?? null },
    }),
  },

  gitlab: {
    config: GITLAB_CONFIG,
    flowType: "authorization_code_pkce",
    buildAuthUrl: (config, redirectUri, state, codeChallenge, meta) => {
      const baseUrl = String((meta as Record<string, JsonValue> | undefined)?.["baseUrl"] ?? config.defaultBaseUrl ?? "");
      const clientId = String((meta as Record<string, JsonValue> | undefined)?.["clientId"] ?? "");
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", state, scope: String(config.scope ?? ""), code_challenge: codeChallenge ?? "", code_challenge_method: String(config.codeChallengeMethod ?? "") });
      return `${baseUrl}${String(config.authorizeUrlPath ?? "")}?${params.toString()}`;
    },
    exchangeToken: async (config, code, redirectUri, codeVerifier, _state, meta) => {
      const baseUrl = String((meta as Record<string, JsonValue> | undefined)?.["baseUrl"] ?? config.defaultBaseUrl ?? "");
      const clientId = String((meta as Record<string, JsonValue> | undefined)?.["clientId"] ?? "");
      const clientSecret = String((meta as Record<string, JsonValue> | undefined)?.["clientSecret"] ?? "");
      const body = new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
      if (clientSecret) body.set("client_secret", clientSecret);
      const response = await fetch(`${baseUrl}${String(config.tokenUrlPath ?? "")}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() });
      if (!response.ok) throw new Error(`GitLab token exchange failed: ${await response.text()}`);
      const tokens = await response.json() as Record<string, JsonValue>;
      const userRes = await fetch(`${baseUrl}${String(config.userInfoUrlPath ?? "")}`, { headers: { Authorization: `Bearer ${String(tokens["access_token"] ?? "")}` } });
      const user = userRes.ok ? await userRes.json() as Record<string, JsonValue> : {};
      return { ...tokens, _user: user, _baseUrl: baseUrl, _clientId: clientId };
    },
    mapTokens: (tokens) => {
      const user = (tokens["_user"] as Record<string, JsonValue> | undefined) ?? {};
      return { accessToken: String(tokens["access_token"] ?? ""), refreshToken: String(tokens["refresh_token"] ?? ""), expiresIn: Number(tokens["expires_in"] ?? 0), scope: String(tokens["scope"] ?? ""), providerSpecificData: { username: String(user["username"] ?? ""), email: String(user["email"] ?? user["public_email"] ?? ""), name: String(user["name"] ?? ""), baseUrl: String(tokens["_baseUrl"] ?? ""), clientId: String(tokens["_clientId"] ?? ""), authKind: "oauth" } };
    },
  },

  codebuddy: {
    config: CODEBUDDY_CONFIG,
    flowType: "device_code",
    requestDeviceCode: async (config) => {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "User-Agent": String(config.userAgent ?? ""), "X-Requested-With": "XMLHttpRequest", "X-Domain": "copilot.tencent.com", "X-No-Authorization": "true", "X-No-User-Id": "true", "X-Product": "SaaS" };
      const response = await fetch(`${String(config.stateUrl ?? "")}?platform=${String(config.platform ?? "")}`, { method: "POST", headers, body: "{}" });
      if (!response.ok) throw new Error(`CodeBuddy state request failed: ${await response.text()}`);
      const data = await response.json() as Record<string, JsonValue>;
      if (data["code"] !== 0 || !(data["data"] as Record<string, JsonValue> | undefined)?.["state"] || !(data["data"] as Record<string, JsonValue> | undefined)?.["authUrl"]) throw new Error(`CodeBuddy state error: ${String(data["msg"] ?? "missing state/authUrl")}`);
      const d = data["data"] as Record<string, JsonValue>;
      return { device_code: d["state"] ?? null, verification_uri: d["authUrl"] ?? null, user_code: "", interval: Number(config.pollInterval ?? 3000) / 1000, _isCodeBuddy: true };
    },
    pollToken: async (config, deviceCode) => {
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "User-Agent": String(config.userAgent ?? ""), "X-Requested-With": "XMLHttpRequest", "X-Domain": "copilot.tencent.com", "X-No-Authorization": "true", "X-No-User-Id": "true", "X-Product": "SaaS" };
      const response = await fetch(String(config.tokenUrl ?? ""), { method: "POST", headers, body: JSON.stringify({ state: deviceCode }) });
      if (!response.ok) return { ok: false, data: { error: "request_failed" } };
      const data = await response.json() as Record<string, JsonValue>;
      const d = data["data"] as Record<string, JsonValue> | undefined;
      if (data["code"] === 0 && d?.["accessToken"]) return { ok: true, data: { access_token: d["accessToken"], refresh_token: d["refreshToken"] ?? "", token_type: d["tokenType"] ?? "Bearer" } };
      if (data["code"] === 11217) return { ok: true, data: { error: "authorization_pending" } };
      return { ok: false, data: { error: data["msg"] ?? "unknown_error" } };
    },
    mapTokens: (tokens) => ({ accessToken: String(tokens["access_token"] ?? ""), refreshToken: String(tokens["refresh_token"] ?? ""), expiresIn: 86400, providerSpecificData: {} }),
  },
};

// ---------------------------------------------------------------------------
// Exported functions (filled in phase 3)
// ---------------------------------------------------------------------------

export function getProvider(name: string) {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown provider: ${name}`);
  return provider;
}

export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

export async function generateAuthData(providerName: string, redirectUri: string | null, meta?: Record<string, JsonValue>) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta ?? {})
    : provider.config;
  const { codeVerifier, codeChallenge, state } = generatePKCE(provider.pkceVerifierBytes);

  let authUrl: string | null;
  if (provider.flowType === "device_code") {
    authUrl = null;
  } else if (provider.flowType === "authorization_code_pkce") {
    authUrl = provider.buildAuthUrl!(config, redirectUri ?? "", state, codeChallenge, meta ?? {});
  } else {
    authUrl = provider.buildAuthUrl!(config, redirectUri ?? "", state, undefined, meta ?? {});
  }

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath ?? "/callback",
  };
}

export async function exchangeTokens(providerName: string, code: string, redirectUri: string, codeVerifier: string, state: string, meta?: Record<string, JsonValue>) {
  const provider = getProvider(providerName);
  const config = provider.prepareConfig
    ? await provider.prepareConfig(provider.config, meta ?? {})
    : provider.config;
  const tokens = await provider.exchangeToken!(config, code, redirectUri, codeVerifier, state, meta ?? {});
  const extra = provider.postExchange ? await provider.postExchange(tokens) : null;
  return provider.mapTokens(tokens, extra);
}

export async function requestDeviceCode(providerName: string, codeChallenge: string | undefined, options?: Record<string, JsonValue>) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") throw new Error(`Provider ${providerName} does not support device code flow`);
  return await provider.requestDeviceCode!(provider.config, codeChallenge ?? "", options ?? {});
}

export async function pollForToken(providerName: string, deviceCode: string, codeVerifier: string, extraData?: Record<string, JsonValue>) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken!(provider.config, deviceCode, codeVerifier, extraData);

  if (result.ok) {
    if (result.data["access_token"]) {
      let extra = null;
      if (provider.postExchange) {
        extra = await provider.postExchange(result.data);
      }
      const tokens = provider.mapTokens(result.data, extra);
      if (providerName === "kiro" && !tokens.providerSpecificData?.["profileArn"]) {
        const profileArn = await fetchKiroProfileArn(tokens.accessToken);
        if (profileArn) tokens.providerSpecificData = { ...tokens.providerSpecificData, profileArn };
      }
      return { success: true as const, tokens };
    } else {
      const err = result.data["error"];
      if (err === "authorization_pending" || err === "slow_down") {
        return {
          success: false as const,
          error: err,
          errorDescription: result.data["error_description"] ?? result.data["message"],
          pending: err === "authorization_pending",
        };
      } else {
        return {
          success: false as const,
          error: result.data["error"] ?? "no_access_token",
          errorDescription: result.data["error_description"] ?? result.data["message"] ?? "No access token received",
        };
      }
    }
  }

  return {
    success: false as const,
    error: result.data["error"],
    errorDescription: result.data["error_description"],
  };
}

let codexBackfillDone = false;
export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c["idToken"]) return false;
      return !c.email || !(c["providerSpecificData"] as Record<string, JsonValue> | null | undefined)?.["chatgptAccountId"];
    });
    for (const conn of targets) {
      const idToken = String(conn["idToken"] ?? "");
      const info = extractCodexAccountInfo(idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch: Record<string, JsonValue> = {};
      if (!conn.email && info.email) patch["email"] = info.email;
      if (info.chatgptAccountId ?? info.chatgptPlanType) {
        const existing = (conn["providerSpecificData"] as Record<string, JsonValue> | null | undefined) ?? {};
        patch["providerSpecificData"] = { ...existing, chatgptAccountId: info.chatgptAccountId ?? null, chatgptPlanType: info.chatgptPlanType ?? null };
      }
      if (Object.keys(patch).length) await updateProviderConnection(conn.id, patch);
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", (err as Error)?.message ?? err);
  }
}
