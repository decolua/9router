import { NextResponse } from "next/server";
import { getAntigravityQuotaCache } from "@/sse/services/antigravityQuota";

export const dynamic = "force-dynamic";

/**
 * GET /api/providers/antigravity/cooldowns
 * Returns live quota cache for all antigravity connections.
 */
export async function GET() {
  const cache = getAntigravityQuotaCache();
  const result = {};
  const now = Date.now();

  for (const [connId, quotas] of cache.entries()) {
    const active = {};
    for (const [model, q] of Object.entries(quotas)) {
      if (q.remainingPercentage <= 0 && q.resetAt) {
        const resetMs = new Date(q.resetAt).getTime();
        if (resetMs > now) {
          active[model] = {
            remainingPercentage: q.remainingPercentage,
            resetAt: q.resetAt,
            remainingSeconds: Math.ceil((resetMs - now) / 1000),
          };
        }
      }
    }
    if (Object.keys(active).length > 0) result[connId] = active;
  }

  return NextResponse.json(result);
}
