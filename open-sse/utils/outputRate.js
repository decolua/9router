// Output rate (tok/s) of a streamed response, from the token usage and the
// latency object saved with each request detail. Pure — shared by the 📊 DONE
// log line and the dashboard, so the two always agree.
//
// `latency.generation` is the first → last output chunk window in ms. The first
// token opens that window, so it does not count toward the rate. Returns null when
// there is no window to measure: non-streaming requests, rows saved before the
// window was recorded, or output that arrived in a single chunk.
export function outputTokensPerSecond(usage, latency) {
  const outTok = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const generation = latency?.generation;
  if (!(generation > 0) || outTok <= 1) return null;
  return Math.round((outTok - 1) * 1000 / generation);
}
