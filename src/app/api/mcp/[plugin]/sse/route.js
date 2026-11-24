import { registerSession, unregisterSession, findPlugin } from "@/lib/mcp/stdioSseBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { plugin } = await params;
  if (!findPlugin(plugin)) {
    return new Response(`Unknown plugin: ${plugin}`, { status: 404 });
  }

  const encoder = new TextEncoder();
  let sid;
  let released = false;

  // Idempotent: request.signal abort and cancel() can both fire, and releasing twice
  // would run the bridge's "last session leaves" branch a second time.
  const release = () => {
    if (released || !sid) return;
    released = true;
    unregisterSession(plugin, sid);
  };

  // request.signal fires reliably on client disconnect; ReadableStream.cancel() is
  // not always invoked in Next.js (same reason as translator/console-logs/stream).
  // unregisterSession is what reaps the spawned child, so a missed cancel() leaves
  // sessions.size > 0 and the stdio process alive for the lifetime of the server.
  request?.signal?.addEventListener("abort", release, { once: true });

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk) => controller.enqueue(encoder.encode(chunk));
      sid = registerSession(plugin, send);
      // MCP SSE handshake: tell client where to POST messages.
      send(`event: endpoint\ndata: /api/mcp/${plugin}/message?sessionId=${sid}\n\n`);
    },
    cancel() {
      release();
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
