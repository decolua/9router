import type { NextRequest } from "next/server";
import type { JsonValue, ExecutorBody, ExecutorCredentials } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnections, updateProviderConnection } from "@/lib/localDb.js";
import { getExecutor } from "open-sse/index.js";

async function persistRefreshedCredentials(connection: ProviderConnection, newCredentials: Partial<ExecutorCredentials>) {
  const updateData: Record<string, JsonValue> = {};

  const creds = newCredentials as Record<string, JsonValue>;
  if (creds["accessToken"]) updateData["accessToken"] = creds["accessToken"];
  if (creds["refreshToken"]) updateData["refreshToken"] = creds["refreshToken"];
  if (creds["idToken"]) updateData["idToken"] = creds["idToken"];
  if (creds["lastRefreshAt"]) updateData["lastRefreshAt"] = creds["lastRefreshAt"];
  if (typeof creds["expiresIn"] === "number") {
    updateData["expiresIn"] = creds["expiresIn"];
    updateData["expiresAt"] = new Date(Date.now() + creds["expiresIn"] * 1000).toISOString();
  } else if (creds["expiresAt"]) {
    updateData["expiresAt"] = creds["expiresAt"];
  }

  const providerSpecificUpdates: Record<string, string> = {
    ...(typeof creds["providerSpecificData"] === "object" && creds["providerSpecificData"] !== null && !Array.isArray(creds["providerSpecificData"])
      ? creds["providerSpecificData"] as Record<string, string>
      : {}),
    ...(typeof creds["copilotToken"] === "string" ? { copilotToken: creds["copilotToken"] } : {}),
    ...(typeof creds["copilotTokenExpiresAt"] === "string" ? { copilotTokenExpiresAt: creds["copilotTokenExpiresAt"] } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData["providerSpecificData"] = {
      ...(typeof connection["providerSpecificData"] === "object" && connection["providerSpecificData"] !== null ? connection["providerSpecificData"] as Record<string, string> : {}),
      ...providerSpecificUpdates,
    };
  }

  if (Object.keys(updateData).length > 0) {
    await updateProviderConnection(connection.id, updateData);
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await request.json() as { provider?: string; model?: string; body?: ExecutorBody };
    const { provider, model, body } = parsed;

    if (!provider || !model || !body) {
      return Response.json({ success: false, error: "provider, model, and body required" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const connection = connections.find((c) => c.isActive !== false);
    if (!connection) {
      return Response.json({ success: false, error: `No active connection for provider: ${provider}` }, { status: 400 });
    }

    const psd = typeof connection["providerSpecificData"] === "object" && connection["providerSpecificData"] !== null
      ? connection["providerSpecificData"] as Record<string, string | boolean | undefined>
      : undefined;

    const credentials: ExecutorCredentials = {
      connectionId: connection.id,
      ...(typeof connection["apiKey"] === "string" ? { apiKey: connection["apiKey"] } : {}),
      ...(typeof connection["accessToken"] === "string" ? { accessToken: connection["accessToken"] } : {}),
      ...(typeof psd?.["copilotToken"] === "string" ? { copilotToken: psd["copilotToken"] } : {}),
      ...(psd !== undefined ? { providerSpecificData: psd } : {}),
    };

    const executor = getExecutor(provider);
    const stream = body["stream"] !== false;

    let { response } = await executor.execute({ model, body, stream, credentials });

    // Auto-refresh token on 401/403 and retry (same as chatCore.js)
    if (response.status === 401 || response.status === 403) {
      const newCredentials = await executor.refreshCredentials(credentials, console);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        Object.assign(credentials, newCredentials);
        await persistRefreshedCredentials(connection, newCredentials);
        ({ response } = await executor.execute({ model, body, stream, credentials }));
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Translator] Provider error ${response.status}:`, errorText.slice(0, 500));
      return Response.json({ success: false, error: `Provider error: ${response.status}`, details: errorText }, { status: response.status });
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Translator] Send error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
