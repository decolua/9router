import { getMcpServers, getMcpServerById } from "@/models";
import { sendToMcpServer, getGatewaySession } from "@/lib/mcp/mcpServerManager";
import { checkRateLimit } from "@/lib/mcp/rateLimiter";
import { validateApiKey } from "@/lib/localDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mcp-gateway/message - Unified message routing
// Routes a JSON-RPC request to the appropriate MCP server.
// When __mcpServerId is provided, routes to that specific server.
// For tools/list without __mcpServerId, aggregates from ALL active servers.
// For tools/call, auto-routes based on tool name prefix (e.g. "stitch__create_project").
// Auth: Accepts Bearer token, X-Api-Key, X-9r-Api-Key, or X-Goog-Api-Key headers.
export async function POST(request) {
  try {
    // Auth check: accept Bearer token, X-Api-Key, X-9r-Api-Key, or X-Goog-Api-Key
    const authHeader = request.headers.get("Authorization");
    const apiKeyHeader = request.headers.get("x-api-key") || request.headers.get("x-9r-api-key") || request.headers.get("x-goog-api-key");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyHeader;
    if (token) {
      const valid = await validateApiKey(token);
      if (!valid) {
        return Response.json(
          { error: "Invalid API key" },
          { status: 401 }
        );
      }
    }

    // Rate limit: 60 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    const rateCheck = checkRateLimit(`mcp:message:${ip}`, {
      maxRequests: 60,
      windowMs: 60_000,
    });
    if (!rateCheck.allowed) {
      return Response.json(
        { error: "Rate limit exceeded", retryAfterMs: rateCheck.retryAfterMs },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
            "X-RateLimit-Remaining": String(rateCheck.remaining),
            "X-RateLimit-Reset": String(Date.now() + rateCheck.resetMs),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    const text = await request.text();
    if (!text || text.trim() === "") {
      return new Response("", { status: 202 });
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (err) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32700, message: "Parse error: invalid JSON" } },
        { status: 400 }
      );
    }

    const { __mcpServerId, ...jsonRpc } = body;

    // Intercept client's initialize/initialized notifications
    if (!__mcpServerId && jsonRpc.method === "initialize") {
      const response = {
        jsonrpc: "2.0",
        id: jsonRpc.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {
              listChanged: true
            },
            prompts: {
              listChanged: true
            },
            resources: {
              listChanged: true
            }
          },
          serverInfo: {
            name: "9router-mcp-gateway",
            version: "1.0.0"
          }
        }
      };
      return await sendResponse(response);
    }

    if (!__mcpServerId && jsonRpc.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }

    // ─── tools/list aggregation ──────────────────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "tools/list") {
      const response = await handleToolsList(jsonRpc);
      return await sendResponse(response);
    }

    // ─── tools/call auto-routing ─────────────────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "tools/call") {
      const response = await handleToolsCall(jsonRpc);
      return await sendResponse(response);
    }

    // ─── prompts/list aggregation ────────────────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "prompts/list") {
      const response = await handlePromptsList(jsonRpc);
      return await sendResponse(response);
    }

    // ─── prompts/get auto-routing ────────────────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "prompts/get") {
      const response = await handlePromptsGet(jsonRpc);
      return await sendResponse(response);
    }

    // ─── resources/list aggregation ──────────────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "resources/list") {
      const response = await handleResourcesList(jsonRpc);
      return await sendResponse(response);
    }

    // ─── resources/templates/list aggregation ────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "resources/templates/list") {
      const response = await handleResourceTemplatesList(jsonRpc);
      return await sendResponse(response);
    }

    // ─── resources/read auto-routing ─────────────────────────────────────
    if (!__mcpServerId && jsonRpc.method === "resources/read") {
      const response = await handleResourcesRead(jsonRpc);
      return await sendResponse(response);
    }

    // ─── Direct routing ──────────────────────────────────────────────────
    let server;
    if (__mcpServerId) {
      server = await getMcpServerById(__mcpServerId);
      if (!server) {
        return Response.json({ error: `Unknown MCP server: ${__mcpServerId}` }, { status: 404 });
      }
    } else {
      const servers = await getMcpServers({ isActive: true });
      if (servers.length === 0) {
        return Response.json({ error: "No active MCP servers configured" }, { status: 404 });
      }
      server = servers[0];
    }

    if (!server.isActive) {
      return Response.json({ error: "MCP server is disabled" }, { status: 400 });
    }

    const response = await sendToMcpServer(server, jsonRpc);

    // Helper function to return response or route it to SSE
    async function sendResponse(result) {
      let data = result;
      if (result instanceof Response) {
        data = await result.json();
      }

      if (sessionId) {
        const session = getGatewaySession(sessionId);
        if (session) {
          session.send(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
          return new Response("", { status: 202 });
        }
      }

      return Response.json(data);
    }

    if (response) {
      return await sendResponse(response);
    }
    return new Response("", { status: 202 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ─── Aggregate tools/list from all active servers ───────────────────────────

// Map server names to short prefixes for tool names
function getServerPrefix(server) {
  const name = server.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.includes("testsprite")) return "ts";
  if (name.includes("sentry")) return "sr";
  if (name.includes("firecrawl")) return "fc";
  if (name.includes("puppeteer")) return "pp";
  if (name.includes("astro")) return "ad";
  if (name.includes("stitch")) return "st";
  if (name.includes("github")) return "gh";
  if (name.includes("tavily")) return "tv";
  
  return name.slice(0, 3);
}

async function handleToolsList(jsonRpc) {
  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      result: { tools: [] },
    };
  }

  const allTools = [];

  const promises = servers.map(async (server) => {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: `tools-list-${server.id}`,
        method: "tools/list",
        params: jsonRpc.params || {},
      });

      if (response?.result?.tools) {
        const prefix = getServerPrefix(server);
        for (const tool of response.result.tools) {
          allTools.push({
            name: `${prefix}__${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      }
    } catch (err) {
      console.error(`[mcp-gateway] tools/list failed for ${server.name}:`, err.message);
    }
  });

  await Promise.all(promises);

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      tools: allTools,
    },
  };
}

// ─── Auto-route tools/call by prefix ────────────────────────────────────────

async function handleToolsCall(jsonRpc) {
  const toolName = jsonRpc.params?.name || "";
  const servers = await getMcpServers({ isActive: true });

  // Check if tool name has a prefix (e.g. "stitch__create_project" or "Hacker-News__get_stories")
  const prefixMatch = toolName.match(/^(.+?)__(.+)$/);

  if (prefixMatch) {
    const [, prefix, originalName] = prefixMatch;
    // Find server matching this prefix by normalized prefix or exact name match
    const normalizedPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
    const server = servers.find((s) => {
      const sPrefix = getServerPrefix(s);
      return sPrefix === normalizedPrefix || s.name.toLowerCase() === prefix.toLowerCase();
    });
    if (!server) {
      return {
        jsonrpc: "2.0",
        id: jsonRpc.id,
        result: {
          content: [{ type: "text", text: `No server found with prefix "${prefix}". Available: ${servers.map((s) => getServerPrefix(s)).join(", ")}` }],
          isError: true,
        },
      };
    }

    const response = await sendToMcpServer(server, {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      method: "tools/call",
      params: { ...jsonRpc.params, name: originalName },
    });
    return response;
  }

  // No prefix — try all servers, return first success
  for (const server of servers) {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: jsonRpc.id,
        method: "tools/call",
        params: jsonRpc.params,
      });
      if (response?.result) return response;
    } catch { /* try next server */ }
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      content: [{ type: "text", text: `No server could handle tool "${toolName}". Try prefixed name like "stitch__${toolName}".` }],
      isError: true,
    },
  };
}

// ─── Aggregate and route prompts ───────────────────────────────────────────

async function handlePromptsList(jsonRpc) {
  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      result: { prompts: [] },
    };
  }

  const allPrompts = [];

  const promises = servers.map(async (server) => {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: `prompts-list-${server.id}`,
        method: "prompts/list",
        params: jsonRpc.params || {},
      });

      if (response?.result?.prompts) {
        const prefix = getServerPrefix(server);
        for (const prompt of response.result.prompts) {
          allPrompts.push({
            name: `${prefix}__${prompt.name}`,
            description: prompt.description,
            arguments: prompt.arguments,
          });
        }
      }
    } catch (err) {
      console.error(`[mcp-gateway] prompts/list failed for ${server.name}:`, err.message);
    }
  });

  await Promise.all(promises);

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      prompts: allPrompts,
    },
  };
}

async function handlePromptsGet(jsonRpc) {
  const promptName = jsonRpc.params?.name || "";
  const prefixMatch = promptName.match(/^(.+?)__(.+)$/);

  if (prefixMatch) {
    const [, prefix, originalName] = prefixMatch;
    const servers = await getMcpServers({ isActive: true });
    const normalizedPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
    const server = servers.find((s) => {
      const sPrefix = getServerPrefix(s);
      return sPrefix === normalizedPrefix || s.name.toLowerCase() === prefix.toLowerCase();
    });

    if (server) {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: jsonRpc.id,
        method: "prompts/get",
        params: {
          ...jsonRpc.params,
          name: originalName,
        },
      });
      return response;
    }
  }

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    error: {
      code: -32602,
      message: `Prompt "${promptName}" not found or prefix invalid.`,
    },
  };
}

// ─── Aggregate and route resources ─────────────────────────────────────────

async function handleResourcesList(jsonRpc) {
  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      result: { resources: [] },
    };
  }

  const allResources = [];

  const promises = servers.map(async (server) => {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: `resources-list-${server.id}`,
        method: "resources/list",
        params: jsonRpc.params || {},
      });

      if (response?.result?.resources) {
        const prefix = getServerPrefix(server);
        for (const res of response.result.resources) {
          allResources.push({
            uri: `mcp-gateway://${prefix}?uri=${encodeURIComponent(res.uri)}`,
            name: res.name,
            description: res.description,
            mimeType: res.mimeType,
          });
        }
      }
    } catch (err) {
      console.error(`[mcp-gateway] resources/list failed for ${server.name}:`, err.message);
    }
  });

  await Promise.all(promises);

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      resources: allResources,
    },
  };
}

async function handleResourceTemplatesList(jsonRpc) {
  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      result: { resourceTemplates: [] },
    };
  }

  const allTemplates = [];

  const promises = servers.map(async (server) => {
    try {
      const response = await sendToMcpServer(server, {
        jsonrpc: "2.0",
        id: `resource-templates-${server.id}`,
        method: "resources/templates/list",
        params: jsonRpc.params || {},
      });

      if (response?.result?.resourceTemplates) {
        const prefix = getServerPrefix(server);
        for (const tpl of response.result.resourceTemplates) {
          allTemplates.push({
            uriTemplate: `mcp-gateway://${prefix}?uriTemplate=${encodeURIComponent(tpl.uriTemplate)}`,
            name: tpl.name,
            description: tpl.description,
            mimeType: tpl.mimeType,
          });
        }
      }
    } catch (err) {
      console.error(`[mcp-gateway] resources/templates/list failed for ${server.name}:`, err.message);
    }
  });

  await Promise.all(promises);

  return {
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      resourceTemplates: allTemplates,
    },
  };
}

async function handleResourcesRead(jsonRpc) {
  const uriStr = jsonRpc.params?.uri || "";
  if (uriStr.startsWith("mcp-gateway://")) {
    try {
      const url = new URL(uriStr);
      const prefix = url.hostname;
      const originalUri = url.searchParams.get("uri");

      if (originalUri) {
        const servers = await getMcpServers({ isActive: true });
        const normalizedPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
        const server = servers.find((s) => {
          const sPrefix = getServerPrefix(s);
          return sPrefix === normalizedPrefix || s.name.toLowerCase() === prefix.toLowerCase();
        });

        if (server) {
          const response = await sendToMcpServer(server, {
            jsonrpc: "2.0",
            id: jsonRpc.id,
            method: "resources/read",
            params: {
              ...jsonRpc.params,
              uri: originalUri,
            },
          });
          return response;
        }
      }
    } catch (err) {
      console.error(`[mcp-gateway] Failed to parse resource read URI:`, err.message);
    }
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
