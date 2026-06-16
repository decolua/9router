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
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
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
