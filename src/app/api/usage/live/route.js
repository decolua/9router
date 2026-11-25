import { requireDashboardAdmin } from "@/dashboardGuard";
import { getProviderConnections, getProviderNodes } from "@/lib/db/index.js";
import { AI_PROVIDERS } from "@/shared/constants/providers.js";
import { getLiveRoutesSnapshot, subscribeLiveRoutes } from "@/lib/observability/liveRoutes.js";

export const dynamic = "force-dynamic";

function sse(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

async function accountMeta() {
  try {
    const [rows, nodes] = await Promise.all([getProviderConnections(), getProviderNodes()]);
    const nodeNames = new Map(nodes.map(node => [node.id, node.name]).filter(([, name]) => name));
    return rows.map(row => ({
      id: row.id,
      provider: row.provider,
      providerName: AI_PROVIDERS[row.provider]?.name || nodeNames.get(row.provider) || row.provider,
      label: row.name || row.email || row.id,
      email: row.email || null,
      iconId: row.provider,
    }));
  } catch {
    return [];
  }
}

export async function GET(request) {
  const denied = await requireDashboardAdmin(request);
  if (denied) return denied;

  const encoder = new TextEncoder();
  const accounts = await accountMeta();
  let closeStream = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let ping = null;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsubscribe();
        try { controller.close(); } catch { /* client already disconnected */ }
      };
      closeStream = close;
      const write = (event, payload) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(sse(event, payload))); } catch { close(); }
      };
      unsubscribe = subscribeLiveRoutes(batch => {
        for (const event of batch) write(event.type, event.record);
      });
      write("snapshot", { records: getLiveRoutesSnapshot(), accounts, process: process.pid });
      ping = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { close(); }
      }, 15_000);
      ping.unref?.();
      request.signal?.addEventListener?.("abort", close, { once: true });
    },
    cancel() { closeStream(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
