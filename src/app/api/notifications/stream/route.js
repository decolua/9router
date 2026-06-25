import { notificationEmitter } from "@/sse/services/notifier";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = { closed: false, sendNotification: null, keepalive: null };

  const stream = new ReadableStream({
    async start(controller) {
      state.sendNotification = (payload) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          state.closed = true;
          notificationEmitter.off("notification", state.sendNotification);
        }
      };

      notificationEmitter.on("notification", state.sendNotification);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          notificationEmitter.off("notification", state.sendNotification);
          clearInterval(state.keepalive);
        }
      }, 25000);
    },

    cancel() {
      state.closed = true;
      notificationEmitter.off("notification", state.sendNotification);
      if (state.keepalive) clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
