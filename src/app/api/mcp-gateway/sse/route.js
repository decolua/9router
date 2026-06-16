import { getMcpServers } from "@/models";
import { createMcpSSEStream } from "@/lib/mcp/mcpServerManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mcp-gateway/sse - Unified SSE stream across all active MCP servers
// Merges events from all active servers into a single stream.
// Keeps the connection alive as long as at least one server is streaming.
export async function GET(request) {
  const servers = await getMcpServers({ isActive: true });
  if (servers.length === 0) {
    return new Response("No active MCP servers configured", { status: 404 });
  }

  const encoder = new TextEncoder();
  let clientConnected = true;

  const stream = new ReadableStream({
    async start(controller) {
      // MCP SSE handshake: endpoint first (tells client where to POST), then connected
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: /api/mcp-gateway/message\n\n`)
      );
      const serverInfo = servers.map((s) => ({ id: s.id, name: s.name, type: s.type }));
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ servers: serverInfo })}\n\n`)
      );

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
                  controller.enqueue(
                    encoder.encode(`event: message\ndata: ${JSON.stringify(json)}\n\n`)
                  );
                } catch {
                  // Not JSON, pass through with server tag
                  controller.enqueue(
                    encoder.encode(`event: message\ndata: ${JSON.stringify({ data: line.slice(6), __mcpServerId: server.id })}\n\n`)
                  );
                }
              } else if (line.startsWith("event: ")) {
                // Pass through event types (connected, error, process_exit, etc.)
                controller.enqueue(encoder.encode(`${line}\n`));
              }
            }
          }
        } catch (err) {
          if (clientConnected) {
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ __mcpServerId: server.id, error: err.message })}\n\n`)
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
        controller.enqueue(
          encoder.encode(`event: disconnected\ndata: ${JSON.stringify({ reason: "all servers disconnected" })}\n\n`)
        );
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      clientConnected = false;
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
