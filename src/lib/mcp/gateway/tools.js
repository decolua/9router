/**
 * `tools/list` and `tools/call` — the hot path of the MCP gateway.
 *
 * `handleToolsList` aggregates prefixed tools across every active server (with
 * combo-based allow-listing and truncation). `handleToolsCall` routes a call
 * to the right upstream by parsing the prefix; if the tool name isn't
 * prefixed we try every server and return the first successful reply.
 */

import { sendToMcpServer } from "../serverManager/transports.js";
import { getActiveServersCached } from "../activeServers.js";
import {
  getServerPrefix,
  parsePrefixedName,
  findServerByPrefix,
  stripPrefix,
} from "../prefix.js";
import { aggregateAllTools } from "./aggregator.js";

/**
 * Filter aggregated tools by an active combo. Combos can whitelist a set of
 * tool names (matched by full or unprefixed name) and cap the total tool
 * count via `maxTools`.
 */
function applyComboFilter(tools, activeCombo) {
  if (!activeCombo) return tools;

  let filtered = tools;
  if (Array.isArray(activeCombo.tools) && activeCombo.tools.length > 0) {
    filtered = filtered.filter((t) => {
      const original = stripPrefix(t.name);
      return activeCombo.tools.some((allowed) => {
        const trimmed = allowed.trim();
        return t.name === trimmed || original === trimmed;
      });
    });
  }

  if (activeCombo.maxTools !== null && activeCombo.maxTools !== undefined) {
    const max = parseInt(activeCombo.maxTools, 10);
    if (!Number.isNaN(max) && max > 0) filtered = filtered.slice(0, max);
  }

  return filtered;
}

function isToolAllowedByCombo(toolName, activeCombo) {
  if (!activeCombo) return true;
  if (!Array.isArray(activeCombo.tools) || activeCombo.tools.length === 0) {
    return true;
  }
  const original = stripPrefix(toolName);
  return activeCombo.tools.some((allowed) => {
    const trimmed = allowed.trim();
    return toolName === trimmed || original === trimmed;
  });
}

export async function handleToolsList(jsonRpc, activeCombo) {
  const servers = await getActiveServersCached();
  if (servers.length === 0) {
    return { jsonrpc: "2.0", id: jsonRpc.id, result: { tools: [] } };
  }

  const allTools = await aggregateAllTools(servers, jsonRpc.params);
  const filteredTools = applyComboFilter(allTools, activeCombo);

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: { tools: filteredTools },
  };
}

export async function handleToolsCall(jsonRpc, activeCombo) {
  const toolName = jsonRpc.params?.name || "";

  if (!isToolAllowedByCombo(toolName, activeCombo)) {
    return {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      error: {
        code: -32601,
        message: `Tool "${toolName}" is not allowed for combo "${activeCombo.name}".`,
      },
    };
  }

  const servers = await getActiveServersCached();
  const parsed = parsePrefixedName(toolName);

  if (parsed) {
    const { prefix, tail: originalName } = parsed;
    const server = findServerByPrefix(servers, prefix);
    if (!server) {
      return {
        jsonrpc: "2.0",
        id: jsonRpc.id,
        result: {
          content: [
            {
              type: "text",
              text: `No server found with prefix "${prefix}". Available: ${servers
                .map((s) => getServerPrefix(s))
                .join(", ")}`,
            },
          ],
          isError: true,
        },
      };
    }

    return await sendToMcpServer(server, {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      method: "tools/call",
      params: { ...jsonRpc.params, name: originalName },
    });
  }

  // No prefix — try every server and return the first success.
  for (const server of servers) {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: jsonRpc.id,
        method: "tools/call",
        params: jsonRpc.params,
      });
      if (response?.result) return response;
    } catch {
      /* try next server */
    }
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      content: [
        {
          type: "text",
          text: `No server could handle tool "${toolName}". Try prefixed name like "stitch__${toolName}".`,
        },
      ],
      isError: true,
    },
  };
}
