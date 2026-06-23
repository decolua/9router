const DEFAULT_TIMEOUT_MS = 3000;

export async function compressWithHeadroom(body, { enabled, url, model, source = "custom", timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!enabled || !url || !body) return null;

  const key = Array.isArray(body.messages) ? "messages"
    : Array.isArray(body.input) ? "input"
    : null;
  if (!key) return null;

  const original = body[key];
  try {
    const endpoint = `${String(url).replace(/\/$/, "")}/v1/compress`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: original, model }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.messages)) return null;

    body[key] = data.messages;
    return { ...data, model, source };
  } catch {
    return null;
  }
}

export function formatHeadroomLog(stats) {
  if (!stats || !stats.tokens_saved) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const pct = before > 0 ? ((stats.tokens_saved / before) * 100).toFixed(1) : "0";
  return `[Headroom] saved ${stats.tokens_saved} tokens / ${before} (${pct}%) ${after ? `after=${after}` : ""}`.trim();
}
