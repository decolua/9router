import { getConsoleLogs, getConsoleEmitter, initConsoleLogCapture } from "@/lib/consoleLogBuffer";

export const dynamic = "force-dynamic";

initConsoleLogCapture();

export async function GET() {
  const encoder = new TextEncoder();
  const emitter = getConsoleEmitter();
  const state = { closed: false, send: null, keepalive: null };

  const stream = new ReadableStream({
    start(controller) {
      // Send all buffered logs immediately on connect
      const buffered = getConsoleLogs();
      if (buffered.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "init", logs: buffered })}\n\n`));
      }

      // Push new lines as they arrive
      state.send = (line) => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "line", line })}\n\n`));
        } catch {
          state.closed = true;
        }
      };

      // Notify client when cleared
      state.sendClear = () => {
        if (state.closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "clear" })}\n\n`));
        } catch {
          state.closed = true;
        }
      };

      emitter.on("line", state.send);
      emitter.on("clear", state.sendClear);

      // Keepalive ping every 25s
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
      emitter.off("line", state.send);
      emitter.off("clear", state.sendClear);
      clearInterval(state.keepalive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
