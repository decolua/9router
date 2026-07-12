import { getTokenSaverStats, statsEmitter } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "365d"]);

export async function GET(request) {
  const period = new URL(request.url).searchParams.get("period") || "30d";
  if (!VALID_PERIODS.has(period)) return new Response("Invalid period", { status: 400 });

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, send: null };

  const stream = new ReadableStream({
    async start(controller) {
      state.send = async () => {
        if (state.closed) return;
        try {
          const stats = await getTokenSaverStats(period);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          state.closed = true;
          statsEmitter.off("token-saver", state.send);
          clearInterval(state.keepalive);
        }
      };

      await state.send();
      statsEmitter.on("token-saver", state.send);
      state.keepalive = setInterval(() => {
        if (state.closed) return clearInterval(state.keepalive);
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
      statsEmitter.off("token-saver", state.send);
      clearInterval(state.keepalive);
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
