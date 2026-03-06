import { getProviderConnections } from "@/lib/localDb.js";
import { getExecutor, refreshTokenByProvider } from "open-sse/index.js";

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

    const credentials = {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      copilotToken: connection.copilotToken,
      projectId: connection.projectId,
      providerSpecificData: connection.providerSpecificData
    };

    const executor = getExecutor(provider);
    const stream = body.stream !== false;

    let { response } = await executor.execute({ model, body, stream, credentials });

    // Auto-refresh token on 401/403 and retry (same as chatCore.js)
    if (response.status === 401 || response.status === 403) {
      const newCredentials = await refreshTokenByProvider(provider, credentials);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        Object.assign(credentials, newCredentials);
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
        "Connection": "keep-alive"
      }
    });
  } catch (error) {
    console.error("[Translator] Send error:", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
