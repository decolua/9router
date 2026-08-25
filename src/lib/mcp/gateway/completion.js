/**
 * `completion/complete`.
 *
 * Routes autocompletion requests to the upstream server that owns the
 * referenced prompt or resource. Also handles built-in completion for the
 * gateway's own diagnostic prompt and logs resource template.
 */

import { sendToMcpServer } from "../serverManager/transports.js";
import { getActiveServersCached } from "../activeServers.js";
import { parsePrefixedName, findServerByPrefix } from "../prefix.js";

const LOG_LEVELS = ["info", "error", "warn", "debug"];

function completionResult(id, values) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      completion: { values, hasMore: false },
    },
  };
}

async function completePromptRef(jsonRpc, ref) {
  const promptName = ref.name || "";
  const argument = jsonRpc.params?.argument || {};
  const val = String(argument.value || "").toLowerCase();

  if (promptName === "gateway__diagnose") {
    const servers = await getActiveServersCached();
    const values = servers
      .map((s) => s.name)
      .filter((name) => name.toLowerCase().includes(val));
    return completionResult(jsonRpc.id, values);
  }

  const parsed = parsePrefixedName(promptName);
  if (!parsed) return null;

  const servers = await getActiveServersCached();
  const server = findServerByPrefix(servers, parsed.prefix);
  if (!server) return null;

  return await sendToMcpServer(server, {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    method: "completion/complete",
    params: {
      ...jsonRpc.params,
      ref: { ...ref, name: parsed.tail },
    },
  });
}

async function completeResourceRef(jsonRpc, ref) {
  const uriStr = ref.uri || "";
  const argument = jsonRpc.params?.argument || {};
  const val = String(argument.value || "").toLowerCase();

  if (uriStr.startsWith("mcp-gateway://gateway/logs")) {
    return completionResult(
      jsonRpc.id,
      LOG_LEVELS.filter((lvl) => lvl.startsWith(val)),
    );
  }

  if (!uriStr.startsWith("mcp-gateway://")) return null;

  try {
    const url = new URL(uriStr);
    const prefix = url.hostname;
    const originalUri =
      url.searchParams.get("uri") || url.searchParams.get("uriTemplate");
    if (!originalUri) return null;

    const servers = await getActiveServersCached();
    const server = findServerByPrefix(servers, prefix);
    if (!server) return null;

    return await sendToMcpServer(server, {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      method: "completion/complete",
      params: {
        ...jsonRpc.params,
        ref: { ...ref, uri: originalUri },
      },
    });
  } catch (err) {
    console.error(
      `[mcp-gateway] Failed to parse resource completion URI:`,
      err.message,
    );
    return null;
  }
}

export async function handleCompletionComplete(jsonRpc) {
  const ref = jsonRpc.params?.ref;
  if (!ref) {
    return {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      error: { code: -32602, message: "Missing 'ref' parameter." },
    };
  }

  let response = null;
  if (ref.type === "ref/prompt") {
    response = await completePromptRef(jsonRpc, ref);
  } else if (ref.type === "ref/resource") {
    response = await completeResourceRef(jsonRpc, ref);
  }
  if (response) return response;

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    error: {
      code: -32602,
      message: "Prompt/Resource not found or prefix invalid for completion.",
    },
  };
}
