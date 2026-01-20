import { NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_TEST_URL = "https://example.com/";
const DEFAULT_TIMEOUT_MS = 8000;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export async function POST(request) {
  let dispatcher;

  try {
    const body = await request.json();
    const proxyUrl = normalizeString(body?.proxyUrl);

    if (!proxyUrl) {
      return NextResponse.json({ error: "proxyUrl is required" }, { status: 400 });
    }

    const testUrl = normalizeString(body?.testUrl) || DEFAULT_TEST_URL;
    const timeoutMsRaw = Number(body?.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.min(timeoutMsRaw, 30000) : DEFAULT_TIMEOUT_MS;

    try {
      dispatcher = new ProxyAgent({ uri: proxyUrl });
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid proxy URL: ${err?.message || String(err)}` },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await undiciFetch(testUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "9Router",
        },
      });

      return NextResponse.json({
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: testUrl,
        elapsedMs: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const message = err?.name === "AbortError" ? "Proxy test timed out" : (err?.message || String(err));
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}
