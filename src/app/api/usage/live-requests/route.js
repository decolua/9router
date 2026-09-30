import { getRequestDetails, statsEmitter } from "@/lib/usageDb";
import { getSessionContext } from "@/lib/auth/dashboardPermissions";
import { parseAllowedModels } from "@/lib/db/repos/allowedModels.js";

export const dynamic = "force-dynamic";

const MAX_ROWS = 50;
const KEEPALIVE_MS = 25000;
// Light server-side refresh so a newly flushed row appears even when the
// usage event fired before the detail buffer was written. One small query
// per connected client, same cost class as the event-driven push.
const REFRESH_MS = 5000;

// Live inspector rows are metadata only. The stored details also hold the full
// request/response payloads, so those keys are dropped before anything leaves
// the server, same reasoning as the redaction in request-details/route.js.
function toInspectorRow(detail) {
  return {
    id: detail.id,
    timestamp: detail.timestamp,
    provider: detail.provider,
    model: detail.model,
    resolvedModel: detail.resolvedModel,
    connectionId: detail.connectionId,
    status: detail.status,
    latency: detail.latency || {},
    tokens: detail.tokens || {},
    pxpipe: detail.pxpipe,
  };
}

async function loadRecentRows(allowedModelPatterns) {
  const result = await getRequestDetails({ page: 1, pageSize: MAX_ROWS, allowedModelPatterns });
  return (result.details || []).map(toInspectorRow);
}

/**
 * GET /api/usage/live-requests
 * Server-sent events stream of the newest request metadata. The first event is a
 * snapshot, every later event is the refreshed list (the observer is a rolling
 * window, not a delta, so reconnects and dropped events self-heal).
 */
export async function GET(request) {
  // Like the sibling usage endpoints, an absent session means the dashboard runs
  // without login, so the stream stays open. A session only narrows the scope:
  // an API-key login sees requests for the models its key allows.
  const ctx = await getSessionContext();
  const allowedModelPatterns = parseAllowedModels(ctx.allowedModels || "*");

  const encoder = new TextEncoder();
  const state = { closed: false, keepalive: null, refresh: null, push: null };

  const stream = new ReadableStream({
    async start(controller) {
      const detach = () => {
        statsEmitter.off("update", state.push);
        clearInterval(state.keepalive);
        clearInterval(state.refresh);
      };

      state.push = async () => {
        if (state.closed) return;
        try {
          const rows = await loadRecentRows(allowedModelPatterns);
          if (state.closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ _type: "snapshot", rows })}\n\n`));
        } catch {
          state.closed = true;
          detach();
        }
      };

      await state.push();

      statsEmitter.on("update", state.push);

      // The detail writer buffers rows before flushing, so its rows can land
      // after the usage event that triggers a push. This refresh catches the
      // stragglers without changing the event-driven live behavior.
      state.refresh = setInterval(() => {
        if (!state.closed) state.push();
      }, REFRESH_MS);

      state.keepalive = setInterval(() => {
        if (state.closed) { clearInterval(state.keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          state.closed = true;
          detach();
        }
      }, KEEPALIVE_MS);
    },

    cancel() {
      state.closed = true;
      statsEmitter.off("update", state.push);
      clearInterval(state.keepalive);
      clearInterval(state.refresh);
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
