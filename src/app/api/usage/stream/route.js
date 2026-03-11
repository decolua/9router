import { statsEmitter, getActiveRequests, getPendingRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null, sendPending: null };

  const stream = new ReadableStream({
    async start(controller) {
      const push = async () => {
        if (state.closed) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const payload = { activeRequests, recentRequests, errorProvider, pending: getPendingRequests() };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("update", state.send);
          statsEmitter.off("pending", state.sendPending);
          clearInterval(state.keepalive);
        }
      };

      state.send = push;
      state.sendPending = push;

      await push();
      console.log(`[SSE] Client connected | listeners=${statsEmitter.listenerCount("update") + 1}`);

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

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
      statsEmitter.off("pending", state.sendPending);
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
