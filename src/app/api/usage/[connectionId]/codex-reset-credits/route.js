// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { consumeCodexRateLimitResetCredit } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result) {
  const values = [result?.message, result?.code, result?.raw?.detail, result?.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
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

export async function POST(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.provider !== "codex") {
      return Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 });
    }

    const isOAuth = connection.authType === "oauth";
    const isAccessToken = connection.authType === "access_token";
    if (!isOAuth && !isAccessToken) {
      return Response.json({ error: "Codex reset credits require an OAuth or access-token connection." }, { status: 400 });
    }

    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = result.connection;
      } catch (refreshError) {
        console.error("[Codex Reset Credits API] Credential refresh failed:", refreshError);
        return Response.json({ error: `Credential refresh failed: ${refreshError.message}` }, { status: 401 });
      }
    }

    // Server-generated redeem id prevents client-controlled replay
    const redeemRequestId = crypto.randomUUID();
    let consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);

    if (isOAuth && isAuthExpiredResult(consumeResult) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);
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
