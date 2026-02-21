import { getUsageStats, statsEmitter } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null };

  const stream = new ReadableStream({
    async start(controller) {
      state.send = async () => {
        if (state.closed) return;
        try {
          const stats = await getUsageStats();
          if (stats.activeRequests?.length > 0) {
            console.log(`[SSE] Push | active=${stats.activeRequests.length} | ${stats.activeRequests.map(r => r.provider).join(",")}`);
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          // Controller closed → self-cleanup
          state.closed = true;
          statsEmitter.off("update", state.send);
          clearInterval(state.keepalive);
        }
      };

      await state.send();
      console.log(`[SSE] Client connected | listeners=${statsEmitter.listenerCount("update") + 1}`);

      statsEmitter.on("update", state.send);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.send);
      clearInterval(state.keepalive);
      console.log("[SSE] Client disconnected");
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
