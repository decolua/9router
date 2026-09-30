// One place that turns a raw token count into the short form shown next to a model
// or a combo, so every screen reads the same (1.0M, 256k, 200).

export function formatContextWindow(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "?";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
