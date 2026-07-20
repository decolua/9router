import "open-sse/utils/proxyFetch.js";
import { sanitizeOAuthError } from "open-sse/utils/oauthError.js";
import { NextResponse } from "next/server";
import { 
  getProvider, 
  generateAuthData, 
  exchangeTokens, 
  requestDeviceCode, 
  pollForToken 
} from "@/lib/oauth/providers";
import { createProviderConnection } from "@/models";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";
import { proxyOptionsForPool } from "@/lib/oauth/proxyOptions";
import {
  startCodexProxy,
  stopCodexProxy,
  registerCodexSession,
  claimCodexSession,
  isCodexSessionCurrent,
  getCodexSessionStatus,
  clearCodexSession,
  startXaiProxy,
  stopXaiProxy,
  registerXaiSession,
  claimXaiSession,
  isXaiSessionCurrent,
  getXaiSessionStatus,
  clearXaiSession,
  registerAuthorizationFlow,
  claimAuthorizationFlow,
  isAuthorizationFlowCurrent,
  clearAuthorizationFlow,
  reserveDeviceAuthorizationFlow,
  bindDeviceAuthorizationFlow,
  claimDeviceAuthorizationFlow,
  releaseDeviceAuthorizationFlow,
  isDeviceAuthorizationFlowCurrent,
  clearDeviceAuthorizationFlow,
} from "@/lib/oauth/utils/server";

const PUBLIC_DEVICE_ERROR_CODES = new Set(["authorization_pending", "slow_down", "expired_token", "access_denied"]);

function normalizeFlowId(value) {
  if (typeof value !== "string") return "";
  const flowId = value.trim();
  return flowId && flowId.length <= 128 ? flowId : "";
}

function cancelledPollResponse() {
  return NextResponse.json({
    success: false,
    error: "poll_cancelled",
    cancelled: true,
  }, { status: 409 });
}

const PUBLIC_DEVICE_FIELDS = [
  "user_code",
  "verification_uri",
  "verification_uri_complete",
  "interval",
  "expires_in",
];

function publicDeviceData(deviceData, flowId) {
  const result = { flowId };
  for (const field of PUBLIC_DEVICE_FIELDS) {
    if (deviceData?.[field] !== undefined) result[field] = deviceData[field];
  }
  return result;
}

function withProxyPoolData(providerSpecificData, proxyPoolId) {
  return {
    ...(providerSpecificData || {}),
    ...(proxyPoolId && proxyPoolId !== "__none__" ? { proxyPoolId } : {}),
  };
}

function claimOAuthSession(provider, state) {
  if (provider === "codex") return claimCodexSession(state);
  if (provider === "xai") return claimXaiSession(state);
  return claimAuthorizationFlow("oauth", provider, state);
}

function isOAuthSessionCurrent(provider, state, identity) {
  if (provider === "codex") return isCodexSessionCurrent(state, identity);
  if (provider === "xai") return isXaiSessionCurrent(state, identity);
  return isAuthorizationFlowCurrent("oauth", provider, state, identity);
}

function clearOAuthSession(provider, state, identity) {
  if (provider === "codex") return clearCodexSession(state, identity);
  if (provider === "xai") return clearXaiSession(state, identity);
  return clearAuthorizationFlow("oauth", provider, state, identity);
}

async function completeXaiManualCode(code, state, session) {
  if (!session) {
    throw new Error("xAI OAuth session not found; restart the login flow and paste the code again");
  }
  if (!code) throw new Error("Missing xAI authorization code");

  try {
    const tokenData = await exchangeTokens(
      "xai",
      code,
      session.redirectUri,
      session.codeVerifier,
      state,
      undefined,
      session.proxyOptions
    );
    if (!isXaiSessionCurrent(state, session.identity)) {
      throw new Error("OAuth flow was cancelled");
    }
    const connection = await createProviderConnection({
      provider: "xai",
      authType: "oauth",
      ...tokenData,
      providerSpecificData: withProxyPoolData(tokenData.providerSpecificData, session.proxyPoolId),
      expiresAt: tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
        : null,
      testStatus: "active",
    }, {
      beforePersist: () => isXaiSessionCurrent(state, session.identity),
    });
    clearXaiSession(state, session.identity);
    await stopXaiProxy();
    return {
      id: connection.id,
      provider: connection.provider,
      email: connection.email,
      displayName: connection.displayName,
    };
  } catch (err) {
    clearXaiSession(state, session.identity);
    await stopXaiProxy();
    throw err;
  }
}

/**
 * Dynamic OAuth API Route
 * Handles: authorize, exchange, device-code, poll
 */

// GET /api/oauth/[provider]/authorize - Generate auth URL
// GET /api/oauth/[provider]/device-code - Request device code (for device_code flow)
export async function GET(request, { params }) {
  try {
    await ensureOutboundProxyInitialized();
    const { provider, action } = await params;
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";
      const proxyPoolId = searchParams.get("proxyPoolId");
      // Collect provider-specific meta params (e.g. gitlab passes baseUrl, clientId, clientSecret)
      const reservedParams = new Set(["redirect_uri", "proxyPoolId"]);
      const meta = {};
      searchParams.forEach((value, key) => { if (!reservedParams.has(key)) meta[key] = value; });
      const proxyOptions = await proxyOptionsForPool(proxyPoolId);
      const authData = await generateAuthData(
        provider,
        redirectUri,
        Object.keys(meta).length ? meta : undefined,
        proxyOptions
      );
      const context = {
        state: authData.state,
        codeVerifier: authData.codeVerifier,
        redirectUri,
        proxyPoolId: proxyPoolId || "",
        proxyOptions,
        meta: Object.keys(meta).length ? meta : undefined,
      };
      const registered = provider === "codex"
        ? registerCodexSession(context)
        : provider === "xai"
          ? registerXaiSession(context)
          : registerAuthorizationFlow({ kind: "oauth", provider, ...context });
      if (!registered) {
        return NextResponse.json({ error: "OAuth flow capacity reached; retry later" }, { status: 503 });
      }
      const { codeVerifier: _codeVerifier, codeChallenge: _codeChallenge, redirectUri: _redirectUri, ...publicAuthData } = authData;
      return NextResponse.json(publicAuthData);
    }

    if (action === "device-code") {
      const providerData = getProvider(provider);
      if (providerData.flowType !== "device_code") {
        return NextResponse.json({ error: "Provider does not support device code flow" }, { status: 400 });
      }

      const proxyPoolId = searchParams.get("proxyPoolId");
      const proxyOptions = await proxyOptionsForPool(proxyPoolId);
      const authData = await generateAuthData(provider, null, undefined, proxyOptions);
      const flowId = crypto.randomUUID();
      const reservedFlow = reserveDeviceAuthorizationFlow({
        provider,
        flowId,
        proxyPoolId: proxyPoolId || "",
        proxyOptions,
      });
      if (!reservedFlow) {
        return NextResponse.json({ error: "OAuth flow capacity reached; retry later" }, { status: 503 });
      }
      const startUrl = searchParams.get("start_url");
      const region = searchParams.get("region");
      const authMethod = searchParams.get("auth_method");
      const deviceOptions = provider === "kiro"
        ? {
            ...(startUrl ? { startUrl } : {}),
            ...(region ? { region } : {}),
            ...(authMethod ? { authMethod } : {}),
          }
        : undefined;
      
      // Providers that don't use PKCE for device code (Grok CLI HAR: plain device_code, no challenge)
      const noPkceDeviceProviders = [
        "github",
        "kiro",
        "kimi",
        "kimi-coding",
        "kilocode",
        "codebuddy-cn",
        "qoder",
        "grok-cli",
      ];
      try {
        const deviceData = noPkceDeviceProviders.includes(provider)
          ? await requestDeviceCode(provider, undefined, deviceOptions, proxyOptions)
          : await requestDeviceCode(provider, authData.codeChallenge, deviceOptions, proxyOptions);
        const deviceCode = deviceData?.device_code || deviceData?.deviceCode;
        if (!deviceCode || !bindDeviceAuthorizationFlow(provider, flowId, reservedFlow.identity, {
          deviceCode,
          codeVerifier: deviceData.codeVerifier || authData.codeVerifier || null,
          extraData: deviceData,
        })) {
          throw new Error("Device authorization could not be started");
        }
        return NextResponse.json(publicDeviceData(deviceData, flowId));
      } catch (error) {
        clearDeviceAuthorizationFlow(provider, flowId, reservedFlow.identity);
        throw error;
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const publicError = sanitizeOAuthError(error);
    console.log("OAuth GET error:", publicError);
    return NextResponse.json({ error: publicError }, { status: 500 });
  }
}

// POST actions: start-proxy, exchange, poll, manual-code
export async function POST(request, { params }) {
  try {
    await ensureOutboundProxyInitialized();
    const { provider, action } = await params;
    if (action === "start-proxy") {
      const mediaType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
        return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
      }
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }

    if (action === "poll-status") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Poll only supported for codex/xai" }, { status: 400 });
      }
      const state = normalizeFlowId(body.state);
      if (!state) return NextResponse.json({ error: "Missing or invalid state" }, { status: 400 });
      const session = provider === "xai" ? getXaiSessionStatus(state) : getCodexSessionStatus(state);
      if (!session) return NextResponse.json({ status: "unknown" });
      return NextResponse.json(session);
    }

    if (action === "ack-status") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Acknowledgement only supported for codex/xai" }, { status: 400 });
      }
      const state = normalizeFlowId(body.state);
      if (!state) return NextResponse.json({ error: "Missing or invalid state" }, { status: 400 });
      const getStatus = provider === "xai" ? getXaiSessionStatus : getCodexSessionStatus;
      const clearSession = provider === "xai" ? clearXaiSession : clearCodexSession;
      const session = getStatus(state);
      if (session && session.status !== "done" && session.status !== "error") {
        return NextResponse.json({ error: "OAuth result is not ready" }, { status: 409 });
      }
      if (session) clearSession(state);
      return NextResponse.json({ success: true });
    }

    if (action === "stop-proxy") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Proxy only supported for codex/xai" }, { status: 400 });
      }
      const state = body.state === undefined || body.state === null ? "" : normalizeFlowId(body.state);
      const getStatus = provider === "xai" ? getXaiSessionStatus : getCodexSessionStatus;
      const clearSession = provider === "xai" ? clearXaiSession : clearCodexSession;
      const stopProxy = provider === "xai" ? stopXaiProxy : stopCodexProxy;
      if (state) {
        if (!getStatus(state)) {
          return NextResponse.json({ error: "OAuth flow state does not match an active session" }, { status: 409 });
        }
        clearSession(state);
        await stopProxy();
      } else if (!await stopProxy({ orphanOnly: true })) {
        return NextResponse.json({ error: "OAuth flow state is required" }, { status: 409 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "cancel-poll") {
      const flowId = normalizeFlowId(body.flowId);
      if (!flowId) {
        return NextResponse.json({ error: "Missing or invalid flow ID" }, { status: 400 });
      }
      clearDeviceAuthorizationFlow(provider, flowId);
      return NextResponse.json({ success: true });
    }

    if (action === "start-proxy") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Proxy only supported for codex/xai" }, { status: 400 });
      }
      const { appPort } = body;
      const state = normalizeFlowId(body.state);
      if (appPort === undefined || appPort === null || appPort === "") {
        return NextResponse.json({ error: "Missing app_port" }, { status: 400 });
      }
      const appPortNumber = typeof appPort === "number"
        ? appPort
        : typeof appPort === "string" && /^[0-9]+$/.test(appPort)
          ? Number(appPort)
          : Number.NaN;
      if (!Number.isInteger(appPortNumber) || appPortNumber < 1 || appPortNumber > 65535) {
        return NextResponse.json({ error: "Invalid app_port" }, { status: 400 });
      }
      if (!state) return NextResponse.json({ error: "Missing or invalid state" }, { status: 400 });
      const session = provider === "xai" ? getXaiSessionStatus(state) : getCodexSessionStatus(state);
      if (!session || session.status !== "pending") {
        return NextResponse.json({ error: "OAuth flow state does not match an active session" }, { status: 409 });
      }
      const result = provider === "xai"
        ? await startXaiProxy(appPortNumber)
        : await startCodexProxy(appPortNumber);
      const serverSide = result.success === true;
      return NextResponse.json({ ...result, serverSide });
    }

    if (action === "exchange") {
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const state = normalizeFlowId(body.state);
      if (!code) return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
      if (!state) return NextResponse.json({ error: "Missing or invalid state" }, { status: 400 });
      const session = claimOAuthSession(provider, state);
      if (!session) {
        return NextResponse.json({ error: "OAuth flow state is invalid, expired, or already used" }, { status: 409 });
      }
      const { redirectUri, codeVerifier, meta, proxyPoolId, proxyOptions } = session;

      try {
        // Detect if "code" is actually a raw JWT access token (starts with eyJ)
        if (code.startsWith("eyJ") && code.includes(".")) {
          const { extractCodexAccountInfo } = await import("@/lib/oauth/providers");
          const info = extractCodexAccountInfo(code);

        // Also decode JWT directly for ChatGPT website tokens which use
        // top-level account_id/plan_type instead of nested openai auth claims
          let directPayload = {};
          try {
            const b64 = code.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
            const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
            directPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
          } catch {}

          const accountId = info.chatgptAccountId || directPayload.account_id;
          const planType = info.chatgptPlanType || directPayload.plan_type;
          const email = info.email || directPayload.email;

          const providerSpecificData = withProxyPoolData({ authMethod: "access_token" }, proxyPoolId);
          if (accountId) providerSpecificData.chatgptAccountId = accountId;
          if (planType) providerSpecificData.chatgptPlanType = planType;

          if (!isOAuthSessionCurrent(provider, state, session.identity)) {
            return NextResponse.json({ error: "OAuth flow was cancelled" }, { status: 409 });
          }
          const connection = await createProviderConnection({
            provider,
            authType: "access_token",
            accessToken: code,
            email: email || null,
            providerSpecificData,
            testStatus: "active",
          }, {
            beforePersist: () => isOAuthSessionCurrent(provider, state, session.identity),
          });

          return NextResponse.json({
            success: true,
            connection: {
              id: connection.id,
              provider: connection.provider,
              email: connection.email,
              displayName: connection.displayName,
            }
          });
        }

        // Cline and ClinePass use authorization_code without PKCE. Kimchi returns a browser token.
        const noPkceExchangeProviders = ["cline", "clinepass", "kimchi"];
        if (!redirectUri || (!codeVerifier && !noPkceExchangeProviders.includes(provider))) {
          return NextResponse.json({ error: "OAuth flow context is incomplete" }, { status: 409 });
        }

        // Exchange code for tokens (meta carries provider-specific params, e.g. gitlab clientId/baseUrl)
        const tokenData = await exchangeTokens(
          provider,
          code,
          redirectUri,
          codeVerifier,
          state,
          meta,
          proxyOptions
        );

        if (!isOAuthSessionCurrent(provider, state, session.identity)) {
          return NextResponse.json({ error: "OAuth flow was cancelled" }, { status: 409 });
        }
        // Save to database
        const connection = await createProviderConnection({
          provider,
          authType: "oauth",
          ...tokenData,
          providerSpecificData: withProxyPoolData(tokenData.providerSpecificData, proxyPoolId),
          expiresAt: tokenData.expiresIn
            ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
        }, {
          beforePersist: () => isOAuthSessionCurrent(provider, state, session.identity),
        });

        return NextResponse.json({
          success: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
            email: connection.email,
            displayName: connection.displayName,
          }
        });
      } finally {
        clearOAuthSession(provider, state, session.identity);
      }
    }

    if (action === "poll") {
      const flowId = normalizeFlowId(body.flowId);
      if (!flowId) return NextResponse.json({ error: "Missing or invalid flow ID" }, { status: 400 });
      const flow = claimDeviceAuthorizationFlow(provider, flowId);
      if (!flow) return cancelledPollResponse();
      const { deviceCode, codeVerifier, extraData, proxyPoolId, proxyOptions } = flow;

      // Providers that don't use PKCE for device code
      const noPkceProviders = ["github", "kimi", "kimi-coding", "kilocode", "codebuddy-cn", "grok-cli"];
      let result;
      try {
        if (noPkceProviders.includes(provider) || provider === "kiro") {
          result = await pollForToken(provider, deviceCode, null, extraData, proxyOptions);
        } else if (provider === "qoder") {
          if (!codeVerifier) {
            clearDeviceAuthorizationFlow(provider, flowId, flow.identity);
            return NextResponse.json({ error: "OAuth flow context is incomplete" }, { status: 409 });
          }
          result = await pollForToken(provider, deviceCode, codeVerifier, extraData, proxyOptions);
        } else {
          if (!codeVerifier) {
            clearDeviceAuthorizationFlow(provider, flowId, flow.identity);
            return NextResponse.json({ error: "OAuth flow context is incomplete" }, { status: 409 });
          }
          result = await pollForToken(provider, deviceCode, codeVerifier, null, proxyOptions);
        }
      } catch (error) {
        releaseDeviceAuthorizationFlow(provider, flowId, flow.identity);
        throw error;
      }

      if (!isDeviceAuthorizationFlowCurrent(provider, flowId, flow.identity)) return cancelledPollResponse();

      if (result.success) {
        // Save to database (legacy kimi-coding OAuth → dual-auth kimi)
        const providerId = provider === "kimi-coding" ? "kimi" : provider;
        const connection = await createProviderConnection({
          provider: providerId,
          authType: "oauth",
          ...result.tokens,
          providerSpecificData: withProxyPoolData(result.tokens.providerSpecificData, proxyPoolId),
          expiresAt: result.tokens.expiresIn 
            ? new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString() 
            : null,
          testStatus: "active",
        }, {
          beforePersist: () => isDeviceAuthorizationFlowCurrent(provider, flowId, flow.identity),
        });
        clearDeviceAuthorizationFlow(provider, flowId, flow.identity);

        return NextResponse.json({ 
          success: true, 
          connection: {
            id: connection.id,
            provider: connection.provider,
          }
        });
      }

      // Still pending or error - don't create connection for pending states
      const isPending = result.pending || result.error === "authorization_pending" || result.error === "slow_down";
      if (isPending) releaseDeviceAuthorizationFlow(provider, flowId, flow.identity);
      else clearDeviceAuthorizationFlow(provider, flowId, flow.identity);
      
      return NextResponse.json({
        success: false,
        error: PUBLIC_DEVICE_ERROR_CODES.has(result.error)
          ? result.error
          : result.error ? sanitizeOAuthError(result.error) : result.error,
        errorDescription: result.errorDescription
          ? sanitizeOAuthError(result.errorDescription)
          : result.errorDescription,
        pending: isPending,
      });
    }

    if (action === "manual-code") {
      if (provider !== "xai") {
        return NextResponse.json({ error: "Manual code only supported for xai" }, { status: 400 });
      }
      const { code, state, proxyPoolId } = body;
      const sessionState = String(state || "").trim();
      const session = claimXaiSession(sessionState);
      if (!session) {
        return NextResponse.json(
          { error: "xAI OAuth flow state is invalid, expired, or already used" },
          { status: 409 },
        );
      }
      const suppliedProxyPoolId = proxyPoolId && proxyPoolId !== "__none__" ? String(proxyPoolId) : null;
      const sessionProxyPoolId = session?.proxyPoolId && session.proxyPoolId !== "__none__"
        ? String(session.proxyPoolId)
        : null;
      if (proxyPoolId !== undefined && suppliedProxyPoolId !== sessionProxyPoolId) {
        clearXaiSession(sessionState, session.identity);
        await stopXaiProxy();
        return NextResponse.json({ error: "Proxy pool does not match xAI OAuth session" }, { status: 400 });
      }
      const connection = await completeXaiManualCode(
        String(code || "").trim(),
        sessionState,
        session,
      );
      return NextResponse.json({ success: true, connection });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error?.message === "OAuth flow was cancelled") return cancelledPollResponse();
    const publicError = sanitizeOAuthError(error);
    console.log("OAuth POST error:", publicError);
    return NextResponse.json({ error: publicError }, { status: 500 });
  }
}
