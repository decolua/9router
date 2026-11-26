// Prometheus scrape endpoint for the per-key usage/cost metrics (src/lib/observability/metrics.js).
// Outside /api on purpose: no dashboard login (src/dashboardGuard.js passes non-/api,
// non-/dashboard paths through). It has its own gate instead:
//   OBSERVABILITY_METRICS_ENDPOINT_ENABLED   off (default) → 404
//   OBSERVABILITY_METRICS_ENDPOINT_PASSWORD  empty → open; set → Bearer <pw> or Basic (any user, <pw>)
import { parseMetricsConfig, checkMetricsAuth } from "@/lib/observability/metricsConfig.js";
import { collectPrometheusText } from "@/lib/observability/metrics.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request) {
  const config = parseMetricsConfig(process.env);
  if (!config.prometheus.enabled) {
    return new Response("Not Found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
  }
  if (!checkMetricsAuth(request.headers.get("authorization"), config.prometheus.password)) {
    return new Response("Unauthorized\n", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8", "WWW-Authenticate": 'Basic realm="9router metrics", charset="UTF-8"', ...NO_STORE },
    });
  }
  try {
    const text = (await collectPrometheusText()) ?? "";
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", ...NO_STORE },
    });
  } catch (e) {
    console.error("[metrics] collect failed:", e?.message || e);
    return new Response("metrics collection failed\n", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
  }
}
