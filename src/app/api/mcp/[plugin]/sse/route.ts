import { registerSession, unregisterSession, findPlugin } from "@/lib/mcp/stdioSseBridge";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ plugin: string }> }) {
  void request;
  const { plugin } = await context.params;
  if (!findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid: string | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      sid = registerSession(plugin, send);
      // MCP SSE handshake: tell client where to POST messages.
      send(`event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      if (sid) unregisterSession(plugin, sid);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      Connection:          "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
