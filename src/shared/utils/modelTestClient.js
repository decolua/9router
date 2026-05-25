export async function runModelTest({ model, kind } = {}) {
  const res = await fetch("/api/models/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, ...(kind ? { kind } : {}) }),
  });

  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (data && typeof data === "object") {
    return {
      ok: data.ok === true,
      error: data.ok ? "" : (data.error || `HTTP ${res.status}: Model not reachable`),
      status: data.status || res.status,
      latencyMs: data.latencyMs,
    };
  }

  const detail = text.replace(/\s+/g, " ").trim().slice(0, 240);
  return {
    ok: false,
    error: `HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    status: res.status,
  };
}

export function formatModelTestNetworkError(error) {
  const message = error?.message || "request failed";
  return `Network error: ${message}`;
}
