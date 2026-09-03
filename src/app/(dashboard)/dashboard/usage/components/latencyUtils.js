const LOG_TICKS = [100, 300, 1000, 3000, 10000, 30000, 100000];
const logTicks = LOG_TICKS.map((v) => Math.log10(v));

export const MIN_LATENCY_COUNT = 10;

export function buildLatencyData(latencyByModel, metric = "total") {
  const source = latencyByModel || {};
  const entries = Object.entries(source).map(([key, lat]) => ({
    key,
    p50Ttft: lat.p50Ttft || 0,
    p95Ttft: lat.p95Ttft || 0,
    p50Total: lat.p50Total || 0,
    p95Total: lat.p95Total || 0,
    count: lat.count || 0,
  }));

  const noisy = entries.filter((e) => e.count < MIN_LATENCY_COUNT);
  const log10 = (v) => Math.log10(Math.max(1, v));

  const rows = entries
    .filter((e) => e.count >= MIN_LATENCY_COUNT)
    .map((e) => {
      const p50 = metric === "ttft" ? e.p50Ttft : e.p50Total;
      const p95 = metric === "ttft" ? e.p95Ttft : e.p95Total;
      return { ...e, p50Log: log10(p50), p95Log: log10(p95) };
    })
    .sort((a, b) => b.p95Total - a.p95Total);

  const allLogs = rows.flatMap((r) => [r.p50Log, r.p95Log]);
  const domainMin = allLogs.length ? Math.min(...allLogs, log10(100)) : log10(100);
  const domainMax = Math.max(...allLogs, log10(1000));

  const data = rows.map((r) => ({
    ...r,
    p50Frac: allLogs.length ? (r.p50Log - domainMin) / (domainMax - domainMin) : 0,
  }));
  const ticks = logTicks.filter((t) => t >= domainMin - 0.1 && t <= domainMax + 0.1);

  return { data, noisy, domain: [domainMin, domainMax], ticks, excluded: noisy.length };
}
