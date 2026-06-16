import { getMcpServers, getMcpServerById } from "@/models";
import { sendToMcpServer } from "@/lib/mcp/mcpServerManager";
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

    // ─── tools/list aggregation ──────────────────────────────────────────
    // If no __mcpServerId and method is tools/list, aggregate from ALL servers
    if (!__mcpServerId && jsonRpc.method === "tools/list") {
      const response = await handleToolsList(jsonRpc);
      return await sendResponse(response);
    }

    // ─── tools/call auto-routing ─────────────────────────────────────────
    // If no __mcpServerId and method is tools/call, find server from prefix
    if (!__mcpServerId && jsonRpc.method === "tools/call") {
      const response = await handleToolsCall(jsonRpc);
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
        const G_SESSIONS = "__9routerMcpGatewaySessions";
        const session = globalThis[G_SESSIONS]?.get(sessionId);
        if (session) {
          session.send(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
        }
        return new Response("", { status: 202 });
      }

      if (result instanceof Response) {
        return result;
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
  // "Google Stitch" -> "stitch", "GitHub" -> "github", "Tavily" -> "tavily"
  return server.name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
}

async function handleToolsList(jsonRpc) {
  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return Response.json({
      jsonrpc: "2.0",
      id: jsonRpc.id,
      result: { tools: [] },
    });
  }

  const allTools = [];

  for (const server of servers) {
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
            ...tool,
            // Prefix name so AI knows which server to route to
            name: `${prefix}__${tool.name}`,
            // Keep original name in description for reference
            originalName: tool.name,
            _serverId: server.id,
            _serverName: server.name,
          });
        }
      }
    } catch (err) {
      console.error(`[mcp-gateway] tools/list failed for ${server.name}:`, err.message);
    }
  }

  return Response.json({
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      tools: allTools,
      _9router: {
        message: "Tools are prefixed with server name (e.g. stitch__create_project). Call tools directly — 9Router will route to the correct server.",
        servers: servers.map((s) => ({
          prefix: getServerPrefix(s),
          name: s.name,
          type: s.type,
          toolCount: allTools.filter((t) => t._serverId === s.id).length,
        })),
      },
    },
  });
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
      return Response.json({
        jsonrpc: "2.0",
        id: jsonRpc.id,
        result: {
          content: [{ type: "text", text: `No server found with prefix "${prefix}". Available: ${servers.map((s) => getServerPrefix(s)).join(", ")}` }],
          isError: true,
        },
      });
    }

    const response = await sendToMcpServer(server, {
      jsonrpc: "2.0",
      id: jsonRpc.id,
      method: "tools/call",
      params: { ...jsonRpc.params, name: originalName },
    });
    return Response.json(response);
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
      if (response?.result) return Response.json(response);
    } catch { /* try next server */ }
  }

  return Response.json({
    jsonrpc: "2.0",
    id: jsonRpc.id,
    result: {
      content: [{ type: "text", text: `No server could handle tool "${toolName}". Try prefixed name like "stitch__${toolName}".` }],
      isError: true,
    },
  });
}
