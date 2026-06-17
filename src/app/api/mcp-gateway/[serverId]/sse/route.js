import { getMcpServerById } from "@/models";
import { createMcpSSEStream } from "@/lib/mcp/mcpServerManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/mcp-gateway/[serverId]/sse - SSE stream to a specific MCP server
export async function GET(request, { params }) {
  const { serverId } = await params;
  const server = await getMcpServerById(serverId);
  if (!server) {
    return new Response(`Unknown MCP server: ${serverId}`, { status: 404 });
  }
  if (!server.isActive) {
    return new Response("MCP server is disabled", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = createMcpSSEStream(server);
  
  // Wrap with handshake event for MCP SSE protocol
  const wrappedStream = new ReadableStream({
    async start(controller) {
      // Send MCP SSE handshake: endpoint tells client where to POST messages
      controller.enqueue(
        encoder.encode(`event: endpoint\ndata: /api/mcp-gateway/${server.id}/message\n\n`)
      );
      
      const reader = stream.getReader();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += encoder.decode(value, { stream: true });
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
                if (json.method === "initialize" || json.method === "notifications/initialized") {
                  continue;
                }

                controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(json)}\n\n`));
              }
            } catch {
              // Ignore parsing errors/non-JSON message events to keep client connection healthy
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(wrappedStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
