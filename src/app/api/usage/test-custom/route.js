// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { getProviderNodeById } from "@/models";
import { PROVIDERS } from "open-sse/config/providers.js";
import { executeCustomUsageScript } from "open-sse/services/customUsageRunner.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

/**
 * POST /api/usage/test-custom - Test a custom usage script against a connection or provider node
 */
export async function POST(request) {
  let connection;
  try {
    const { connectionId, providerNodeId, script } = await request.json();

    if (!script || typeof script !== "string") {
      return Response.json({ error: "script must be a string" }, { status: 400 });
    }

    if (!connectionId && !providerNodeId) {
      return Response.json({ error: "connectionId or providerNodeId is required" }, { status: 400 });
    }

    let providerNode = null;
    let effectiveConnection = null;

    if (providerNodeId) {
      // Node-level testing: get node config and a connection under it for API key
      providerNode = await getProviderNodeById(providerNodeId);
      if (!providerNode) {
        return Response.json({ error: "Provider node not found" }, { status: 404 });
      }

      // Get first connection under this node for testing (any connection works - they share baseUrl)
      if (connectionId) {
        connection = await getProviderConnectionById(connectionId);
        if (!connection) {
          return Response.json({ error: "Connection not found" }, { status: 404 });
        }
        effectiveConnection = {
          ...connection,
          customUsageConfig: providerNode.customUsageConfig,
        };
      } else {
        // No connectionId, try to find any connection under this node
        const { getProviderConnections } = await import("@/lib/localDb");
        const connections = await getProviderConnections({ provider: providerNodeId });
        if (connections.length > 0) {
          connection = connections[0];
          effectiveConnection = {
            ...connection,
            customUsageConfig: providerNode.customUsageConfig,
          };
        } else {
          return Response.json({ error: "No connections found under this provider node" }, { status: 400 });
        }
      }
    } else if (connectionId) {
      // Legacy: connection-only testing (backward compatibility)
      connection = await getProviderConnectionById(connectionId);
      if (!connection) {
        return Response.json({ error: "Connection not found" }, { status: 404 });
      }
      effectiveConnection = connection;
    }

    // Get provider config
    const providerConfig = PROVIDERS[effectiveConnection.provider];

    // Resolve proxy config
    const proxyConfig = await resolveConnectionProxyConfig(effectiveConnection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    // Execute the custom script with node-level config
    const result = await executeCustomUsageScript(effectiveConnection, providerConfig, script, proxyOptions);

    return Response.json(result);
  } catch (error) {
    console.error("[Usage Test Custom]", error);
    return Response.json(
      { error: error.message || "Failed to test custom usage script" },
      { status: 500 }
    );
  }
}
