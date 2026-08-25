/**
 * `prompts/list` and `prompts/get`.
 *
 * Aggregates prompts from every active upstream server and prefixes them so
 * the client can reference a specific server. Also exposes a built-in
 * `gateway__diagnose` prompt that reports on gateway state.
 */

import { sendToMcpServer } from "../serverManager/transports.js";
import { getActiveServersCached } from "../activeServers.js";
import { parsePrefixedName, findServerByPrefix } from "../prefix.js";
import { aggregateFromServers } from "./aggregator.js";

const GATEWAY_DIAGNOSE_PROMPT = {
  name: "gateway__diagnose",
  description:
    "Diagnose 9router MCP gateway connection issues and view server status",
  arguments: [
    {
      name: "serverId",
      description: "Optional ID of a specific MCP server to test",
      required: false,
    },
  ],
};

function makePromptError(id, promptName) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32602,
      message: `Prompt "${promptName}" not found or prefix invalid.`,
    },
  };
}

export async function handlePromptsList(jsonRpc) {
  const servers = await getActiveServersCached();
  const prompts = [GATEWAY_DIAGNOSE_PROMPT];

  if (servers.length > 0) {
    const upstream = await aggregateFromServers(servers, {
      method: "prompts/list",
      idPrefix: "prompts-list",
      params: jsonRpc.params,
      pluck: (result) => result?.prompts,
      mapItem: (prompt, prefix) => ({
        name: `${prefix}__${prompt.name}`,
        description: prompt.description,
        arguments: prompt.arguments,
      }),
    });
    prompts.push(...upstream);
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: { prompts },
  };
}

async function handleGatewayDiagnosePrompt(jsonRpc) {
  const servers = await getActiveServersCached();
  const lines = servers
    .map(
      (s, idx) => `${idx + 1}. ${s.name} (${s.type}) - Active: ${s.isActive}`,
    )
    .join("\n");
  const text =
    `9router MCP Gateway Diagnostics:\n` +
    `Active Upstream Servers: ${servers.length}\n` +
    `${lines}\n\n` +
    `Please review the logs or run a direct ping to test individual downstream tools.`;

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      description: "Diagnose 9router MCP gateway connection issues",
      messages: [
        { role: "user", content: { type: "text", text } },
      ],
    },
  };
}

export async function handlePromptsGet(jsonRpc) {
  const promptName = jsonRpc.params?.name || "";

  if (promptName === "gateway__diagnose") {
    return await handleGatewayDiagnosePrompt(jsonRpc);
  }

  const parsed = parsePrefixedName(promptName);
  if (!parsed) return makePromptError(jsonRpc.id, promptName);

  const servers = await getActiveServersCached();
  const server = findServerByPrefix(servers, parsed.prefix);
  if (!server) return makePromptError(jsonRpc.id, promptName);

  return await sendToMcpServer(server, {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    method: "prompts/get",
    params: { ...jsonRpc.params, name: parsed.tail },
  });
}
