/**
 * `resources/list`, `resources/templates/list`, `resources/read`.
 *
 * Upstream resources are namespaced under `mcp-gateway://{prefix}?uri=…` so
 * reads can route back to the originating server. Two built-in resources are
 * exposed by the gateway itself:
 *  - `mcp-gateway://gateway/status` — current gateway snapshot
 *  - `mcp-gateway://gateway/logs{?level}` — placeholder (no logs exposed)
 */

import { sendToMcpServer } from "../serverManager/transports.js";
import { getActiveServersCached } from "../activeServers.js";
import { getServerPrefix, findServerByPrefix } from "../prefix.js";
import { aggregateFromServers } from "./aggregator.js";

const GATEWAY_STATUS_URI = "mcp-gateway://gateway/status";
const GATEWAY_LOGS_URI_PREFIX = "mcp-gateway://gateway/logs";

const GATEWAY_STATUS_RESOURCE = {
  uri: GATEWAY_STATUS_URI,
  name: "9router Gateway Status",
  description:
    "Real-time status and active connections of the 9router MCP Gateway",
  mimeType: "application/json",
};

const GATEWAY_LOGS_TEMPLATE = {
  uriTemplate: "mcp-gateway://gateway/logs{?level}",
  name: "9router Gateway Logs",
  description: "Filterable system logs for the 9router MCP Gateway",
  mimeType: "text/plain",
};

// ─── resources/list ────────────────────────────────────────────────────────

export async function handleResourcesList(jsonRpc) {
  const servers = await getActiveServersCached();
  const resources = [GATEWAY_STATUS_RESOURCE];

  if (servers.length > 0) {
    const upstream = await aggregateFromServers(servers, {
      method: "resources/list",
      idPrefix: "resources-list",
      params: jsonRpc.params,
      pluck: (result) => result?.resources,
      mapItem: (res, prefix) => ({
        uri: `mcp-gateway://${prefix}?uri=${encodeURIComponent(res.uri)}`,
        name: res.name,
        description: res.description,
        mimeType: res.mimeType,
      }),
    });
    resources.push(...upstream);
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: { resources },
  };
}

// ─── resources/templates/list ──────────────────────────────────────────────

export async function handleResourceTemplatesList(jsonRpc) {
  const servers = await getActiveServersCached();
  const resourceTemplates = [GATEWAY_LOGS_TEMPLATE];

  if (servers.length > 0) {
    const upstream = await aggregateFromServers(servers, {
      method: "resources/templates/list",
      idPrefix: "resource-templates",
      params: jsonRpc.params,
      pluck: (result) => result?.resourceTemplates,
      mapItem: (tpl, prefix) => ({
        uriTemplate: `mcp-gateway://${prefix}?uriTemplate=${encodeURIComponent(tpl.uriTemplate)}`,
        name: tpl.name,
        description: tpl.description,
        mimeType: tpl.mimeType,
      }),
    });
    resourceTemplates.push(...upstream);
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: { resourceTemplates },
  };
}

// ─── resources/read ────────────────────────────────────────────────────────

async function readGatewayStatus(jsonRpc) {
  const servers = await getActiveServersCached();

  const activeServers = await Promise.all(
    servers.map(async (s) => {
      let tools = [];
      try {
        const response = await sendToMcpServer(s, {
          jsonrpc: "2.0",
          id: `status-tools-${s.id}`,
          method: "tools/list",
          params: {},
        });
        if (response?.result?.tools) {
          const prefix = getServerPrefix(s);
          tools = response.result.tools.map((t) => ({
            name: `${prefix}__${t.name}`,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
        }
      } catch (err) {
        console.error(
          `[mcp-gateway] status tools/list failed for ${s.name}:`,
          err.message,
        );
      }
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        isActive: s.isActive,
        tools,
      };
    }),
  );

  const statusInfo = {
    gateway: "active",
    activeServersCount: servers.length,
    activeServers,
  };

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      contents: [
        {
          uri: GATEWAY_STATUS_URI,
          mimeType: "application/json",
          text: JSON.stringify(statusInfo, null, 2),
        },
      ],
    },
  };
}

function readGatewayLogs(jsonRpc, uriStr) {
  // Server logs are intentionally not exposed via MCP — return a clear,
  // non-fabricated notice instead of synthetic log lines.
  const level = uriStr.includes("level=error") ? "error" : "info";
  const text =
    `9router gateway log streaming is not exposed via this resource.\n` +
    `Requested level: ${level}. Consult your server/container logs for details.`;

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      contents: [{ uri: uriStr, mimeType: "text/plain", text }],
    },
  };
}

async function readUpstreamResource(jsonRpc, uriStr) {
  try {
    const url = new URL(uriStr);
    const prefix = url.hostname;
    const originalUri = url.searchParams.get("uri");
    if (!originalUri) return null;

    const servers = await getActiveServersCached();
    const server = findServerByPrefix(servers, prefix);
    if (!server) return null;

    return await sendToMcpServer(server, {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      method: "resources/read",
      params: { ...jsonRpc.params, uri: originalUri },
    });
  } catch (err) {
    console.error(
      `[mcp-gateway] Failed to parse resource read URI:`,
      err.message,
    );
    return null;
  }
}

export async function handleResourcesRead(jsonRpc) {
  const uriStr = jsonRpc.params?.uri || "";

  if (uriStr === GATEWAY_STATUS_URI) {
    return await readGatewayStatus(jsonRpc);
  }

  if (uriStr.startsWith(GATEWAY_LOGS_URI_PREFIX)) {
    return readGatewayLogs(jsonRpc, uriStr);
  }

  if (uriStr.startsWith("mcp-gateway://")) {
    const response = await readUpstreamResource(jsonRpc, uriStr);
    if (response) return response;
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    error: {
      code: -32602,
      message: `Resource URI "${uriStr}" not found or invalid.`,
    },
  };
}
