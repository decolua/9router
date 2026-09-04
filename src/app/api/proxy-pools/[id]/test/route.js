import { NextResponse } from "next/server";
import { getProxyPoolById, updateProxyPool } from "@/models";
import { testProxyUrl } from "@/lib/network/proxyTest";
import { fetch as undiciFetch } from "undici";

async function testVercelRelay(relayUrl, timeoutMs = 10000) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(relayUrl, {
      method: "GET",
      headers: {
        "x-relay-target": "https://httpbin.org",
        "x-relay-path": "/get",
      },
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err?.name === "AbortError" ? "Relay test timed out" : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

// Anonymity probe: a relay must not forward client-IP headers. Sends a canary
// X-Forwarded-For through the relay to httpbin's header echo; if the canary
// comes back, the relay leaks the origin IP and per-IP upstream rate limits
// (e.g. OpenCode free-tier 429) survive relaying. Old Cloudflare/Deno relay
// code forwards it; Vercel's edge strips it at the platform layer.
async function testRelayIpLeak(relayUrl, timeoutMs = 10000) {
  const canary = `9router-canary-${Date.now().toString(36)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(relayUrl, {
      method: "GET",
      headers: {
        "x-relay-target": "https://httpbin.org",
        "x-relay-path": "/headers",
        "x-forwarded-for": canary,
      },
      signal: controller.signal,
    });
    if (!res.ok) return { checked: false, leaked: null };
    const text = await res.text();
    return { checked: true, leaked: text.toLowerCase().includes(canary.toLowerCase()) };
  } catch {
    return { checked: false, leaked: null };
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/proxy-pools/[id]/test - Test proxy pool entry
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const proxyPool = await getProxyPoolById(id);

    if (!proxyPool) {
      return NextResponse.json({ error: "Proxy pool not found" }, { status: 404 });
    }

    const isRelay = proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno";
    const result = isRelay
      ? await testVercelRelay(proxyPool.proxyUrl)
      : await testProxyUrl({ proxyUrl: proxyPool.proxyUrl });
    // Anonymity probe is informational only — it never flips liveness, so
    // relays that still work for non-IP-sensitive providers stay active.
    let ipLeak = null;
    if (isRelay && result.ok) {
      const leak = await testRelayIpLeak(proxyPool.proxyUrl);
      if (leak.checked) ipLeak = leak.leaked;
    }
    const now = new Date().toISOString();

    await updateProxyPool(id, {
      testStatus: result.ok ? "active" : "error",
      lastTestedAt: now,
      lastError: result.ok ? null : (result.error || `Proxy test failed with status ${result.status}`),
      isActive: result.ok,
    });

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      statusText: result.statusText || null,
      error: result.error || null,
      elapsedMs: result.elapsedMs || 0,
      testedAt: now,
      ipLeak,
      warning: ipLeak === true
        ? "Relay forwards client-IP headers; per-IP upstream limits (e.g. OpenCode free 429) will persist. Redeploy the relay to pick up the anonymized forwarder."
        : null,
    });
  } catch (error) {
    console.log("Error testing proxy pool:", error);
    return NextResponse.json({ error: "Failed to test proxy pool" }, { status: 500 });
  }
}
