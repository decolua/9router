import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

// Structural alias wide enough for getUsageStats() output + patched active-request fields.
// Uses number/string primitives and generic record buckets — no unknown bridge.
type ActiveEntry = { model: string; provider: string; account: string; count: number };
type RecentEntry = { timestamp: string; model: string | null; provider: string; promptTokens: number; completionTokens: number; status: string | null };
type CachedStats = {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  cacheHitRatio: number;
  byProvider: Record<string, object>;
  byModel: Record<string, object>;
  byAccount: Record<string, object>;
  byApiKey: Record<string, object>;
  byEndpoint: Record<string, object>;
  last10Minutes: Array<{ requests: number; promptTokens: number; completionTokens: number; cost: number }>;
  pending: object;
  activeRequests: ActiveEntry[];
  recentRequests: RecentEntry[];
  errorProvider: string;
};

export async function GET() {
  const encoder = new TextEncoder();

  // Declared as non-null refs so emitter on/off always receives a function.
  // eslint-disable-next-line prefer-const
  let send: () => Promise<void>;
  // eslint-disable-next-line prefer-const
  let sendPending: () => Promise<void>;

  let closed = false;
  let keepalive: NodeJS.Timeout | null = null;
  let cachedStats: CachedStats | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      send = async () => {
        if (closed) return;
        try {
          if (cachedStats) {
            const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
            const quickStats: CachedStats = { ...cachedStats, activeRequests, recentRequests, errorProvider };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`));
          }
          const stats = await getUsageStats() as CachedStats;
          cachedStats = stats;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          closed = true;
          statsEmitter.off("update", send);
          statsEmitter.off("pending", sendPending);
          if (keepalive !== null) clearInterval(keepalive);
        }
      };

      sendPending = async () => {
        if (closed || !cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } = await getActiveRequests();
          const stats: CachedStats = { ...cachedStats, activeRequests, recentRequests, errorProvider };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stats)}\n\n`));
        } catch {
          closed = true;
          statsEmitter.off("update", send);
          statsEmitter.off("pending", sendPending);
          if (keepalive !== null) clearInterval(keepalive);
        }
      };

      await send();
      statsEmitter.on("update", send);
      statsEmitter.on("pending", sendPending);

      keepalive = setInterval(() => {
        if (closed) { if (keepalive !== null) clearInterval(keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
          if (keepalive !== null) clearInterval(keepalive);
        }
      }, 25000);
    },

    cancel() {
      closed = true;
      statsEmitter.off("update", send);
      statsEmitter.off("pending", sendPending);
      if (keepalive !== null) clearInterval(keepalive);
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
