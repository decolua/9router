// SSE handshake endpoint for the MCP gateway.
//
// Like the existing /api/mcp/[plugin]/sse, but:
//   - the endpoint URL posted to the client is /api/mcp-gateway/message?sessionId=<sid>
//   - sessions are isolated per gateway call, not per preset stdio plugin
//   - the actual upstream fan-out lives in the message route

import { registerSession, unregisterSession } from "@/lib/mcp/gateway/sseSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let sid = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
      };
      sid = registerSession(send);
      send(`event: endpoint\ndata: /api/mcp-gateway/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      if (sid) unregisterSession(sid);
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
