import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";
import {
  getAdmissionSnapshot,
  subscribeAdmissionChanges,
} from "@/sse/services/accountAdmission.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const state = {
    closed: false,
    keepalive: null,
    send: null,
    sendPending: null,
    cachedStats: null,
    unsubscribeAdmission: null,
  };

  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    statsEmitter.off("update", state.send);
    statsEmitter.off("pending", state.sendPending);
    state.unsubscribeAdmission?.();
    state.unsubscribeAdmission = null;
    clearInterval(state.keepalive);
  };

  const withAdmission = (stats) => ({
    ...stats,
    admission: getAdmissionSnapshot(),
  });

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const quickStats = withAdmission({
              ...state.cachedStats,
              activeRequests,
              recentRequests,
              errorProvider,
            });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          // Then do full recalc and update cache
          const stats = withAdmission(await getUsageStats());
          state.cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats = withAdmission({
            ...state.cachedStats,
            activeRequests,
            recentRequests,
            errorProvider,
          });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          cleanup();
        }
      };

      await state.send();
      if (state.closed) return;

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);
      state.unsubscribeAdmission = subscribeAdmissionChanges(state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
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
