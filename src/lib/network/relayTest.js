import { fetch as undiciFetch } from "undici";

/**
 * Test a relay URL (Vercel / Cloudflare / Deno) by asking it to forward a
 * request to httpbin via the standard relay header contract.
 *
 * All relay edge functions share the same contract:
 *   - require header `x-relay-target`
 *   - optional header `x-relay-path`
 *   - return 400 JSON when `x-relay-target` is missing
 *
 * A healthy relay forwards the GET to https://httpbin.org/get and returns 200.
 *
 * @param {string} relayUrl
 * @param {object} [options]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<{ok: boolean, status: number, statusText: string|null, elapsedMs: number, error: string|null}>}
 */
export async function testRelay(relayUrl, { timeoutMs = 10000 } = {}) {
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
      statusText: res.statusText || null,
      elapsedMs: Date.now() - startedAt,
      error: res.ok ? null : `Relay returned ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      statusText: null,
      elapsedMs: Date.now() - startedAt,
      error: err?.name === "AbortError" ? "Relay test timed out" : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}
