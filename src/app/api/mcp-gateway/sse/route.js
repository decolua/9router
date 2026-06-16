import { getMcpServers } from "@/models";
import { createMcpSSEStream } from "@/lib/mcp/mcpServerManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mcp-gateway/sse - Unified SSE stream across all active MCP servers
// Merges events from all active servers into a single stream.
// Keeps the connection alive as long as at least one server is streaming.
// Auth: Accepts Bearer token or X-Api-Key header (validated against stored keys).
// Also accepts X-9r-Api-Key header for MCP clients.
import { validateApiKey } from "@/lib/localDb";

export async function GET(request) {
  // Auth check: accept Bearer token, X-Api-Key, or X-9r-Api-Key
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("x-api-key") || request.headers.get("x-9r-api-key");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : apiKeyHeader;
  if (token) {
    const valid = await validateApiKey(token);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  // If no token provided, allow through (open gateway mode)
  // The dashboardGuard already whitelists this route

  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return new Response("No active MCP servers configured", { status: 404 });
  }

  const sessionId = crypto.randomUUID();
  const encoder = new TextEncoder();
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      // Register this active client session
      const send = (data) => {
        try {
          if (clientConnected) {
            controller.enqueue(encoder.encode(data));
          }
        } catch {}
      };

      const G_SESSIONS = "__9routerMcpGatewaySessions";
      if (!globalThis[G_SESSIONS]) {
        globalThis[G_SESSIONS] = new Map();
      }
      globalThis[G_SESSIONS].set(sessionId, { send });

      // MCP SSE handshake: endpoint first (tells client where to POST), then connected
      // Return endpoint with sessionId query param so clients route POSTs to this session!
      send(`event: endpoint\ndata: /api/mcp-gateway/message?sessionId=${sessionId}\n\n`);

      const serverInfo = servers.map((s) => ({ id: s.id, name: s.name, type: s.type }));
      send(`event: connected\ndata: ${JSON.stringify({ servers: serverInfo })}\n\n`);

      // Track active streams per server
      const activeReaders = new Map();

      // Open SSE connections to all servers in parallel
      const streamPromises = servers.map(async (server) => {
        try {
          const serverStream = createMcpSSEStream(server);
          const reader = serverStream.getReader();
          activeReaders.set(server.id, reader);

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!clientConnected) break;

            // Forward the raw SSE chunk, preserving event type and data
            const text = new TextDecoder().decode(value);
            const lines = text.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const json = JSON.parse(line.slice(6));
                  json.__mcpServerId = server.id;
                  json.__mcpServerName = server.name;
                  send(`event: message\ndata: ${JSON.stringify(json)}\n\n`);
                } catch {
                  // Not JSON, pass through with server tag
                  send(`event: message\ndata: ${JSON.stringify({ data: line.slice(6), __mcpServerId: server.id })}\n\n`);
                }
              } else if (line.startsWith("event: ")) {
                // Pass through event types (connected, error, process_exit, etc.)
                send(`${line}\n`);
              }
            }
          }
        } catch (err) {
          if (clientConnected) {
            send(`event: error\ndata: ${JSON.stringify({ __mcpServerId: server.id, error: err.message })}\n\n`);
          }
        } finally {
          activeReaders.delete(server.id);
        }
      });

      // Wait for all streams to finish
      await Promise.allSettled(streamPromises);

      // Only close if client is still connected
      if (clientConnected) {
        send(`event: disconnected\ndata: ${JSON.stringify({ reason: "all servers disconnected" })}\n\n`);
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      clientConnected = false;
      const G_SESSIONS = "__9routerMcpGatewaySessions";
      if (globalThis[G_SESSIONS]) {
        globalThis[G_SESSIONS].delete(sessionId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
