import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";

// POST /api/models/test - Ping a single model via internal completions
export async function POST(request) {
  try {
    const { model } = await request.json();
    if (!model) return NextResponse.json({ error: "Model required" }, { status: 400 });

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    // Get an active internal API key for auth (if requireApiKey is enabled)
    let apiKey = null;
    try {
      const keys = await getApiKeys();
      apiKey = keys.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const latencyMs = Date.now() - start;

    // 200 = ok; 400 = bad request but auth passed (model reachable)
    const ok = res.status === 200 || res.status === 400;
    let error = null;
    if (!ok) {
      const text = await res.text().catch(() => "");
      error = `HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`;
    }

    return NextResponse.json({ ok, latencyMs, error });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
