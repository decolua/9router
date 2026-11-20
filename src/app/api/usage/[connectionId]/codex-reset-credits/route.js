// On Node.js, import open-sse/index.js to patch globalThis.fetch for proxy support.
// On Cloudflare Workers this import is deferred: undici references MessagePort which
// doesn't exist in the Workers runtime, so we load the proxy-fetch side-effect lazily.
import { isCloudflareWorker } from "@/shared/utils/runtime";

import { getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

// Lazy-loaded open-sse deps
let _consumeCodexRateLimitResetCredit, _getCodexRateLimitResetCredits;

async function ensureOpenSseDeps() {
  if (_consumeCodexRateLimitResetCredit) return;
  if (!isCloudflareWorker()) {
    await import("open-sse/index.js");
  }
  ({ consumeCodexRateLimitResetCredit: _consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits: _getCodexRateLimitResetCredits } = await import("open-sse/services/usage.js"));
}

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result) {
  const values = [result?.message, result?.code, result?.raw?.detail, result?.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function isAuthExpiredError(error) {
  return isAuthExpiredResult({ message: error?.message });
}

function getResponseForConsumeResult(result, redeemRequestId) {
  if (result.ok) {
    return Response.json({
      code: result.code,
      reset: true,
      windows_reset: result.windowsReset,
      redeemRequestId,
      credit: result.raw?.credit || null,
    });
  }

  if (result.noCredit) {
    return Response.json({
      code: "no_credit",
      reset: false,
      windows_reset: result.windowsReset,
      message: "No Codex reset credits available.",
    }, { status: 409 });
  }

  return Response.json({
    code: result.code || "unknown_response",
    reset: false,
    windows_reset: result.windowsReset,
    message: result.message || "Codex reset credit consume returned an unexpected response.",
  }, { status: result.status >= 400 && result.status < 500 ? result.status : 502 });
}

async function getCodexConnection(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return { response: Response.json({ error: "Connection not found" }, { status: 404 }) };
  }

  if (connection.provider !== "codex") {
    return { response: Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 }) };
  }

  const isOAuth = connection.authType === "oauth";
  const isAccessToken = connection.authType === "access_token";
  if (!isOAuth && !isAccessToken) {
    return { response: Response.json({ error: "Codex reset credits require an OAuth or access-token connection." }, { status: 400 }) };
  }

  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  return { connection, isOAuth, proxyOptions };
}

async function refreshCodexConnection(connection, proxyOptions) {
  try {
    const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    return { connection: result.connection };
  } catch (refreshError) {
    console.error("[Codex Reset Credits API] Credential refresh failed:", refreshError);
    return { response: Response.json({ error: `Credential refresh failed: ${refreshError.message}` }, { status: 401 }) };
  }
}

export async function GET(_request, { params }) {
  let connection;
  try {
    await ensureOpenSseDeps();
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    let result;
    try {
      result = await _getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    } catch (fetchError) {
      if (!isOAuth || !connection.refreshToken || !isAuthExpiredError(fetchError)) throw fetchError;
      const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
      connection = retryResult.connection;
      result = await _getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    }

    return Response.json(result);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Codex Reset Credits] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  let connection;
  try {
    await ensureOpenSseDeps();
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    // Server-generated redeem id prevents client-controlled replay
    const redeemRequestId = crypto.randomUUID();
    let consumeResult = await _consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);

    if (isOAuth && isAuthExpiredResult(consumeResult) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        consumeResult = await _consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);
      } catch (retryError) {
        console.warn(`[Codex Reset Credits] force refresh failed: ${retryError.message}`);
      }
    }

    return getResponseForConsumeResult(consumeResult, redeemRequestId);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Codex Reset Credits] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
