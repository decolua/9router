import "open-sse/utils/proxyFetch.js";
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
  getCodexSessionStatus,
  clearCodexSession,
  startXaiProxy,
  stopXaiProxy,
  registerXaiSession,
  claimXaiSession,
  getXaiSessionStatus,
  clearXaiSession,
} from "@/lib/oauth/utils/server";

const DEVICE_POLL_CANCELLATION_TTL_MS = 15 * 60 * 1000;
const DEVICE_POLL_CANCELLATION_MAX_ENTRIES = 256;
const cancelledDevicePolls = new Map();

function normalizeFlowId(value) {
  if (typeof value !== "string") return "";
  const flowId = value.trim();
  return flowId && flowId.length <= 128 ? flowId : "";
}

function pruneCancelledDevicePolls(now = Date.now()) {
  for (const [key, expiresAt] of cancelledDevicePolls) {
    if (expiresAt <= now) cancelledDevicePolls.delete(key);
  }
}

function devicePollKey(provider, flowId) {
  return `${provider}:${flowId}`;
}

function rememberCancelledDevicePoll(provider, flowId, now = Date.now()) {
  pruneCancelledDevicePolls(now);
  const key = devicePollKey(provider, flowId);
  cancelledDevicePolls.delete(key);
  while (cancelledDevicePolls.size >= DEVICE_POLL_CANCELLATION_MAX_ENTRIES) {
    cancelledDevicePolls.delete(cancelledDevicePolls.keys().next().value);
  }
  cancelledDevicePolls.set(key, now + DEVICE_POLL_CANCELLATION_TTL_MS);
}

function isDevicePollCancelled(provider, flowId) {
  if (!flowId) return false;
  pruneCancelledDevicePolls();
  return cancelledDevicePolls.has(devicePollKey(provider, flowId));
}

function cancelledPollResponse() {
  return NextResponse.json({
    success: false,
    error: "poll_cancelled",
    cancelled: true,
  }, { status: 409 });
}

function withProxyPoolData(providerSpecificData, proxyPoolId) {
  return {
    ...(providerSpecificData || {}),
    ...(proxyPoolId && proxyPoolId !== "__none__" ? { proxyPoolId } : {}),
  };
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
    const connection = await createProviderConnection({
      provider: "xai",
      authType: "oauth",
      ...tokenData,
      providerSpecificData: withProxyPoolData(tokenData.providerSpecificData, session.proxyPoolId),
      expiresAt: tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
        : null,
      testStatus: "active",
    });
    clearXaiSession(state);
    await stopXaiProxy();
    return {
      id: connection.id,
      provider: connection.provider,
      email: connection.email,
      displayName: connection.displayName,
    };
  } catch (err) {
    clearXaiSession(state);
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
      const authData = await generateAuthData(
        provider,
        redirectUri,
        Object.keys(meta).length ? meta : undefined,
        await proxyOptionsForPool(proxyPoolId)
      );
      return NextResponse.json(authData);
    }

    if (action === "poll-status") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Poll only supported for codex/xai" }, { status: 400 });
      }
      const state = searchParams.get("state");
      if (!state) {
        return NextResponse.json({ error: "Missing state" }, { status: 400 });
      }
      const session = provider === "xai" ? getXaiSessionStatus(state) : getCodexSessionStatus(state);
      if (!session) return NextResponse.json({ status: "unknown" });
      if (session.status === "done" || session.status === "error") {
        const payload = {
          status: session.status,
          ...(session.connectionId ? { connectionId: session.connectionId } : {}),
          ...(session.email ? { email: session.email } : {}),
          ...(session.error ? { error: session.error } : {}),
        };
        if (provider === "xai") clearXaiSession(state);
        else clearCodexSession(state);
        return NextResponse.json(payload);
      }
      return NextResponse.json({ status: session.status });
    }

    if (action === "stop-proxy") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Proxy only supported for codex/xai" }, { status: 400 });
      }
      const state = searchParams.get("state");
      if (provider === "xai") {
        if (state) clearXaiSession(state);
        await stopXaiProxy({ orphanOnly: !state });
      } else {
        if (state) clearCodexSession(state);
        await stopCodexProxy({ orphanOnly: !state });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "device-code") {
      const providerData = getProvider(provider);
      if (providerData.flowType !== "device_code") {
        return NextResponse.json({ error: "Provider does not support device code flow" }, { status: 400 });
      }

      const proxyPoolId = searchParams.get("proxyPoolId");
      const proxyOptions = await proxyOptionsForPool(proxyPoolId);
      const authData = await generateAuthData(provider, null, undefined, proxyOptions);
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
      let deviceData;
      if (noPkceDeviceProviders.includes(provider)) {
        deviceData = await requestDeviceCode(provider, undefined, deviceOptions, proxyOptions);
      } else {
        // Qwen and other PKCE providers
        deviceData = await requestDeviceCode(provider, authData.codeChallenge, deviceOptions, proxyOptions);
      }

      return NextResponse.json({
        ...deviceData,
        // Prefer the verifier the provider's requestDeviceCode generated for
        // itself (qoder rolls its own PKCE pair); fall back to the generic one.
        codeVerifier: deviceData.codeVerifier || authData.codeVerifier,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.log("OAuth GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    if (action === "cancel-poll") {
      const flowId = normalizeFlowId(body.flowId);
      if (!flowId) {
        return NextResponse.json({ error: "Missing or invalid flow ID" }, { status: 400 });
      }
      rememberCancelledDevicePoll(provider, flowId);
      return NextResponse.json({ success: true });
    }

    if (action === "start-proxy") {
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Proxy only supported for codex/xai" }, { status: 400 });
      }
      const { appPort, state, codeVerifier, redirectUri, proxyPoolId } = body;
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
      const proxyOptions = await proxyOptionsForPool(proxyPoolId);
      const result = provider === "xai"
        ? await startXaiProxy(appPortNumber)
        : await startCodexProxy(appPortNumber);
      let serverSide = false;
      if (result.success && state && codeVerifier && redirectUri) {
        serverSide = provider === "xai"
          ? registerXaiSession({ state, codeVerifier, redirectUri, proxyPoolId, proxyOptions })
          : registerCodexSession({ state, codeVerifier, redirectUri, proxyPoolId, proxyOptions });
      }
      return NextResponse.json({ ...result, serverSide });
    }

    if (action === "exchange") {
      const { code, redirectUri, codeVerifier, state, meta, proxyPoolId } = body;

      // Detect if "code" is actually a raw JWT access token (starts with eyJ)
      if (code && code.startsWith("eyJ") && code.includes(".")) {
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

        const connection = await createProviderConnection({
          provider,
          authType: "access_token",
          accessToken: code,
          email: email || null,
          providerSpecificData,
          testStatus: "active",
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
      if (!code || !redirectUri || (!codeVerifier && !noPkceExchangeProviders.includes(provider))) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      // Exchange code for tokens (meta carries provider-specific params, e.g. gitlab clientId/baseUrl)
      const tokenData = await exchangeTokens(
        provider,
        code,
        redirectUri,
        codeVerifier,
        state,
        meta,
        await proxyOptionsForPool(proxyPoolId)
      );

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

    if (action === "poll") {
      const { deviceCode, codeVerifier, extraData, proxyPoolId } = body;
      const flowId = body.flowId === undefined ? "" : normalizeFlowId(body.flowId);

      if (!deviceCode) {
        return NextResponse.json({ error: "Missing device code" }, { status: 400 });
      }
      if (body.flowId !== undefined && !flowId) {
        return NextResponse.json({ error: "Invalid flow ID" }, { status: 400 });
      }
      if (isDevicePollCancelled(provider, flowId)) return cancelledPollResponse();

      // Providers that don't use PKCE for device code
      const noPkceProviders = ["github", "kimi", "kimi-coding", "kilocode", "codebuddy-cn", "grok-cli"];
      const proxyOptions = await proxyOptionsForPool(proxyPoolId);
      let result;
      if (noPkceProviders.includes(provider)) {
        // kimi needs extraData._kimiDeviceId for stable X-Msh-Device-Id (CLIProxyAPI parity)
        result = await pollForToken(provider, deviceCode, null, extraData, proxyOptions);
      } else if (provider === "kiro") {
        // Kiro needs extraData (clientId, clientSecret) from device code response
        result = await pollForToken(provider, deviceCode, null, extraData, proxyOptions);
      } else if (provider === "qoder") {
        // Qoder needs both the PKCE verifier (codeVerifier) and the machineId
        // captured at device-code time (extraData._qoderMachineId) so
        // mapTokens can persist it for COSY signing.
        if (!codeVerifier) {
          return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
        }
        result = await pollForToken(provider, deviceCode, codeVerifier, extraData, proxyOptions);
      } else {
        // Qwen and other PKCE providers
        if (!codeVerifier) {
          return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
        }
        result = await pollForToken(provider, deviceCode, codeVerifier, null, proxyOptions);
      }

      if (isDevicePollCancelled(provider, flowId)) return cancelledPollResponse();

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
        });

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
      
      return NextResponse.json({
        success: false,
        error: result.error,
        errorDescription: result.errorDescription,
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
      const suppliedProxyPoolId = proxyPoolId && proxyPoolId !== "__none__" ? String(proxyPoolId) : null;
      const sessionProxyPoolId = session?.proxyPoolId && session.proxyPoolId !== "__none__"
        ? String(session.proxyPoolId)
        : null;
      if (proxyPoolId !== undefined && suppliedProxyPoolId !== sessionProxyPoolId) {
        clearXaiSession(sessionState);
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
    console.log("OAuth POST error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
