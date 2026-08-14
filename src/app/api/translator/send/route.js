import { getProviderConnections, updateProviderConnection } from "@/lib/localDb.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { getExecutor } from "open-sse/index.js";
import { resolveAntigravityProjectId } from "open-sse/services/projectId.js";

async function persistRefreshedCredentials(connection, newCredentials) {
  const updateData = {};

  if (newCredentials.accessToken) updateData.accessToken = newCredentials.accessToken;
  if (newCredentials.refreshToken) updateData.refreshToken = newCredentials.refreshToken;
  if (newCredentials.idToken) updateData.idToken = newCredentials.idToken;
  if (newCredentials.lastRefreshAt) updateData.lastRefreshAt = newCredentials.lastRefreshAt;
  if (newCredentials.expiresIn) {
    updateData.expiresIn = newCredentials.expiresIn;
    updateData.expiresAt = new Date(Date.now() + newCredentials.expiresIn * 1000).toISOString();
  } else if (newCredentials.expiresAt) {
    updateData.expiresAt = newCredentials.expiresAt;
  }

  const providerSpecificUpdates = {
    ...(newCredentials.providerSpecificData || {}),
    ...(newCredentials.copilotToken ? { copilotToken: newCredentials.copilotToken } : {}),
    ...(newCredentials.copilotTokenExpiresAt ? { copilotTokenExpiresAt: newCredentials.copilotTokenExpiresAt } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }

  if (Object.keys(updateData).length > 0) {
    await updateProviderConnection(connection.id, updateData);
  }
}

export async function POST(request) {
  try {
    const { provider, model, body } = await request.json();

    if (!provider || !model || !body) {
      return Response.json({ success: false, error: "provider, model, and body required" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const connection = connections.find(c => c.isActive !== false);
    if (!connection) {
      return Response.json({ success: false, error: `No active connection for provider: ${provider}` }, { status: 400 });
    }

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    let projectId = connection.projectId;
    if ((provider === "antigravity" || provider === "gemini-cli") && !projectId) {
      projectId = await resolveAntigravityProjectId({ credentials: connection, connectionId: connection.id, accessToken: connection.accessToken, provider });
      if (projectId) {
        await updateProviderConnection(connection.id, { projectId });
      }
    }

    const credentials = {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      lastRefreshAt: connection.lastRefreshAt,
      connectionId: connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
      projectId: projectId,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        proxySource: resolvedProxy.source || "none",
      }
    };

    const proxyOptions = {
      connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
      connectionProxyUrl: resolvedProxy.connectionProxyUrl,
      connectionNoProxy: resolvedProxy.connectionNoProxy,
      vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      proxySource: resolvedProxy.source || "none",
      proxyPoolId: resolvedProxy.proxyPoolId || null,
    };

    const executor = getExecutor(provider);
    const stream = body.stream !== false;

    let { response } = await executor.execute({ model, body, stream, credentials, proxyOptions });

    // Auto-refresh token on 401/403 and retry (same as chatCore.js)
    if (response.status === 401 || response.status === 403) {
      const newCredentials = await executor.refreshCredentials(credentials, console, proxyOptions);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        Object.assign(credentials, newCredentials);
        await persistRefreshedCredentials(connection, newCredentials);
        ({ response } = await executor.execute({ model, body, stream, credentials, proxyOptions }));
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
        "Connection": "keep-alive"
      }
    });
  } catch (error) {
    console.error("[Translator] Send error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
