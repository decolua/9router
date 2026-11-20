// On Node.js, import open-sse/index.js to patch globalThis.fetch for proxy support.
// On Cloudflare Workers this import is deferred: undici references MessagePort which
// doesn't exist in the Workers runtime, so we load the proxy-fetch side-effect lazily.
import { isCloudflareWorker } from "@/shared/utils/runtime";

import { getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";

// Spend one free Claude "limit reset" grant (irreversible)
export async function POST(request, { params }) {
  try {
    // Lazy-load open-sse deps to avoid undici crash on CF Workers
    if (!isCloudflareWorker()) {
      await import("open-sse/index.js");
    }
    const { consumeClaudeResetGrant } = await import("open-sse/services/usage.js");
    const { connectionId } = await params;
    const { grantId } = await request.json().catch(() => ({}));

    let connection = await getProviderConnectionById(connectionId);
    if (!connection) return Response.json({ error: "Connection not found" }, { status: 404 });
    if (connection.provider !== "claude" || connection.authType !== "oauth") {
      return Response.json({ error: "Limit reset is only available for Claude OAuth connections." }, { status: 400 });
    }

    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    ({ connection } = await refreshAndUpdateCredentials(connection, false, proxyOptions));
    const result = await consumeClaudeResetGrant(connection.accessToken, grantId, proxyOptions);

    if (result.ok) return Response.json(result);
    const status = result.status >= 400 && result.status < 500 ? result.status : 409;
    return Response.json({ ...result, message: result.message || `Reset not applied: ${result.reason || result.result || "unknown"}` }, { status });
  } catch (error) {
    console.warn(`[Claude Reset] ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
