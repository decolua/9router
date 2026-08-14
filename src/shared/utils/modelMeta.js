// Formatting helpers for model metadata display (context window, max output, pricing).

export function formatTokenCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function formatPricePerM(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const str = abs >= 1 ? n.toFixed(2) : abs >= 0.01 ? n.toFixed(3) : n.toFixed(4);
  return str.replace(/\.?0+$/, "");
}

// Build a compact meta line: "200k ctx · 64k out · $3.00/$15.00" (null when no data)
export function formatModelMeta(caps, pricing) {
  const parts = [];
  const ctx = formatTokenCount(caps?.contextWindow);
  if (ctx) parts.push(`${ctx} ctx`);
  const out = formatTokenCount(caps?.maxOutput);
  if (out) parts.push(`${out} out`);
  const pin = formatPricePerM(pricing?.input);
  const pout = formatPricePerM(pricing?.output);
  if (pin !== null || pout !== null) parts.push(`$${pin ?? "?"}/$${pout ?? "?"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
