import { statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

// The stream only feeds live fields (activeRequests, recentRequests,
// errorProvider, pending) — full per-period stats come from the REST route,
// where each client picks its own window. One shared hub computes and encodes
// the payload ONCE per event tick and hands every connected client the same
// chunk; clients never trigger their own getUsageStats() recompute.
const hub = global._usageStatsHub ??= {
  clients: new Set(), // per-connection (chunk) => void enqueue handlers
  timer: null,
  started: false,
};

async function refreshAndBroadcast() {
  if (!hub.clients.size) return;
  try {
    const payload = await getActiveRequests();
    const chunk = new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
    for (const send of [...hub.clients]) {
      try { send(chunk); } catch { hub.clients.delete(send); }
    }
  } catch {
    // transient compute failure — next event retries; clients keep their last frame
  }
}

function scheduleRefresh() {
  if (hub.timer) return; // collapse update/pending bursts into one refresh
  hub.timer = setTimeout(() => {
    hub.timer = null;
    refreshAndBroadcast();
  }, 50);
  hub.timer.unref?.();
}

if (!hub.started) {
  hub.started = true;
  statsEmitter.on("update", scheduleRefresh);
  statsEmitter.on("pending", scheduleRefresh);
}

export async function GET() {
  const state = { closed: false, keepalive: null, send: null };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const detach = () => {
        if (state.closed) return;
        state.closed = true;
        if (state.send) hub.clients.delete(state.send);
        clearInterval(state.keepalive);
      };

      state.send = (chunk) => {
        if (state.closed) throw new Error("closed");
        controller.enqueue(chunk);
      };

      // Initial lightweight snapshot; full stats arrive via the client's own
      // REST fetch for its chosen period.
      try {
        const payload = await getActiveRequests();
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      } catch {
        detach();
        return;
      }

      hub.clients.add(state.send);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          detach();
        }
      }, 25000);
    },

    cancel() {
      if (state.send) hub.clients.delete(state.send);
      state.closed = true;
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
