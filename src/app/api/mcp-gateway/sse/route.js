import { getMcpServers } from "@/models";
import {
  createMcpSSEStream,
  registerGatewaySession,
  unregisterGatewaySession,
  SUPPORTED_PROTOCOL_VERSIONS,
  deriveSessionOwner,
} from "@/lib/mcp";
import { validateApiKey } from "@/lib/localDb";
import { isMcpApiKey } from "@/shared/utils/mcpApiKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mcp-gateway/sse - Unified SSE stream across all active MCP servers
// Merges events from all active servers into a single stream.
// Keeps the connection alive as long as at least one server is streaming.
// Auth: ONLY accepts MCP-kind keys (mcp_ prefix), completely separate from v1 API keys (sk- prefix).

export async function GET(request) {
  // Auth check: MCP gateway ONLY accepts MCP-kind keys (mcp_ prefix)
  // This is completely separate from v1 API keys (sk- prefix)
  // Extract token from headers
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader =
    request.headers.get("x-api-key") ||
    request.headers.get("x-9r-api-key") ||
    request.headers.get("x-mcp-api-key");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : apiKeyHeader;

  // SECURITY: Token is REQUIRED - fail closed if not provided
  if (!token) {
    return new Response(
      JSON.stringify({
        error:
          "Authorization required. Provide MCP API key via Authorization: Bearer <key> or x-api-key header",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // Only accept MCP-kind keys for gateway access
  if (!isMcpApiKey(token)) {
    return new Response(
      JSON.stringify({
        error: "Invalid API key. MCP gateway requires mcp_ prefix keys",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const valid = await validateApiKey(token, "mcp");
  if (!valid) {
    return new Response(
      JSON.stringify({ error: "Invalid or inactive MCP API key" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // 1. Accept validation
  const acceptHeader = request.headers.get("accept");
  if (acceptHeader && !acceptHeader.includes("text/event-stream") && !acceptHeader.includes("*/*")) {
    return new Response(
      JSON.stringify({
        error: "Not Acceptable: Client must accept text/event-stream",
      }),
      {
        status: 406,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // 2. mcp-protocol-version validation
  const protocolVersion = request.headers.get("mcp-protocol-version");
  if (protocolVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    return new Response(
      JSON.stringify({
        error: `Unsupported protocol version: ${protocolVersion}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`,
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return new Response("No active MCP servers configured", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const comboParam = searchParams.get("combo");
  const comboQuery = comboParam
    ? `&combo=${encodeURIComponent(comboParam)}`
    : "";

  const sessionId = crypto.randomUUID();
  const ownerId = deriveSessionOwner(token);
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

      registerGatewaySession(sessionId, send, ownerId);

      // MCP SSE handshake: endpoint first (tells client where to POST), then connected
      // Return endpoint with sessionId query param so clients route POSTs to this session!
      send(
        `event: endpoint\ndata: /api/mcp-gateway/message?sessionId=${sessionId}${comboQuery}\n\n`,
      );

      const serverInfo = servers.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
      }));
      send(
        `event: connected\ndata: ${JSON.stringify({ servers: serverInfo })}\n\n`,
      );

      // Track active streams per server
      const activeReaders = new Map();

      // Open SSE connections to all servers in parallel
      const streamPromises = servers.map(async (server) => {
        try {
          const serverStream = createMcpSSEStream(server);
          const reader = serverStream.getReader();
          activeReaders.set(server.id, reader);

          let buffer = "";
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!clientConnected) break;

            buffer += decoder.decode(value, { stream: true });
            let match;
            while ((match = buffer.match(/\r?\n\r?\n/))) {
              const boundaryIdx = match.index;
              const block = buffer.slice(0, boundaryIdx).trim();
              buffer = buffer.slice(boundaryIdx + match[0].length);
              if (!block) continue;

              const lines = block.split(/\r?\n/);
              let eventType = "message";
              let data = "";
              for (const line of lines) {
                if (line.startsWith("event: ")) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  data += (data ? "\n" : "") + line.slice(6);
                } else if (line.startsWith("data:")) {
                  data += (data ? "\n" : "") + line.slice(5);
                }
              }

              // Only forward message events to MCP client
              if (eventType !== "message") {
                continue;
              }

              try {
                const json = JSON.parse(data.trim());
                if (json.jsonrpc === "2.0") {
                  // Discard internal initialize responses
                  if (json.result && json.result.protocolVersion) {
                    continue;
                  }
                  // Discard initialize requests/notifications
                  if (
                    json.method === "initialize" ||
                    json.method === "notifications/initialized"
                  ) {
                    continue;
                  }

                  json.__mcpServerId = server.id;
                  json.__mcpServerName = server.name;
                  send(`event: message\ndata: ${JSON.stringify(json)}\n\n`);
                }
              } catch {
                // Ignore parsing errors/non-JSON message events to keep client connection healthy
              }
            }
          }
        } catch (err) {
          if (clientConnected) {
            send(
              `event: error\ndata: ${JSON.stringify({ __mcpServerId: server.id, error: err.message })}\n\n`,
            );
          }
        } finally {
          activeReaders.delete(server.id);
        }
      });

      // Wait for all streams to finish
      await Promise.allSettled(streamPromises);

      // Only close if client is still connected
      if (clientConnected) {
        send(
          `event: disconnected\ndata: ${JSON.stringify({ reason: "all servers disconnected" })}\n\n`,
        );
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      clientConnected = false;
      unregisterGatewaySession(sessionId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "mcp-session-id": sessionId,
    },
  });
}
