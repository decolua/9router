// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnectionById } from "@/lib/localDb";
import { consumeCodexRateLimitResetCredit } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/lib/providers/refreshCredentials.js";

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result: { message?: string; code?: string; raw?: { detail?: string; error?: string } }) {
  const values = [result?.message, result?.code, result?.raw?.detail, result?.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function getResponseForConsumeResult(result: {
  ok?: boolean;
  noCredit?: boolean;
  code?: string;
  windowsReset?: JsonValue;
  raw?: { credit?: JsonValue };
  message?: string;
  status?: number;
}, redeemRequestId: string) {
  if (result.ok) {
    return Response.json({
      code: result.code,
      reset: true,
      windows_reset: result.windowsReset,
      redeemRequestId,
      credit: result.raw?.credit ?? null,
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
  }, { status: result.status != null && result.status >= 400 && result.status < 500 ? result.status : 502 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  let connection;
  try {
    const { connectionId } = await context.params;
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection["provider"] !== "codex") {
      return Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 });
    }

    const isOAuth = connection["authType"] === "oauth";
    const isAccessToken = connection["authType"] === "access_token";
    if (!isOAuth && !isAccessToken) {
      return Response.json({ error: "Codex reset credits require an OAuth or access-token connection." }, { status: 400 });
    }

    const psd = connection["providerSpecificData"] as Record<string, string> | undefined;
    const proxyConfig = await resolveConnectionProxyConfig(psd);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(connection, false, proxyOptions as never);
        connection = result.connection as ProviderConnection;
      } catch (refreshError) {
        console.error("[Codex Reset Credits API] Credential refresh failed:", refreshError);
        const msg = refreshError instanceof Error ? refreshError.message : String(refreshError);
        return Response.json({ error: `Credential refresh failed: ${msg}` }, { status: 401 });
      }
    }

    const redeemRequestId = crypto.randomUUID();
    let consumeResult = await consumeCodexRateLimitResetCredit(connection["accessToken"], redeemRequestId, proxyOptions as never);

    if (isOAuth && isAuthExpiredResult(consumeResult) && connection["refreshToken"]) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions as never);
        connection = retryResult.connection as ProviderConnection;
        consumeResult = await consumeCodexRateLimitResetCredit(connection["accessToken"], redeemRequestId, proxyOptions as never);
      } catch (retryError) {
        const msg = retryError instanceof Error ? retryError.message : String(retryError);
        console.warn(`[Codex Reset Credits] force refresh failed: ${msg}`);
      }
    }

    return getResponseForConsumeResult(consumeResult, redeemRequestId);
  } catch (error) {
    const provider = typeof connection?.["provider"] === "string" ? connection["provider"] : "unknown";
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[Codex Reset Credits] ${provider}: ${msg}`);
    return Response.json({ error: msg }, { status: 500 });
  }
}
