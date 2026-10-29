/**
 * Regression tests for DF-9ROUTER-42 — gzip responses must never reach a
 * .json() consumer through the proxyFetch-wrapped fetch.
 *
 * Defect (measured 2026-09-25, pre-fix): after the undici 7.19.2 -> 8.11.0
 * bump (89c0084f), provider upstream calls in the Next runtime hand a RAW
 * GZIP body to providerResponse.json() and throw
 * `Unexpected token \u001f ... is not valid JSON` — chat 503
 * "Invalid JSON response from gemini", images/TTS 502. The same chain
 * decompresses transparently with undici 7, in bare node with undici 8, and
 * inside vitest — the trigger is undici 8 + the proxyFetch patch + the Next
 * runtime, so this suite pins the CONTRACT at the patched-fetch boundary:
 * whatever inner fetch ran (native or stub), a response that still carries
 * `content-encoding: gzip` must be delivered to the caller with its body
 * already decompressed.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { gzipSync } from "node:zlib";

const PATCH_MARK = Symbol.for("9router.proxyFetch.patched");
const INNER_FETCH = Symbol.for("9router.proxyFetch.innerFetch");
const PROXY_WARN_SEEN = Symbol.for("9router.proxyFetch.warnedProxyFailures");

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

let savedEnv;
let originalFetch;
let warnSpy;

beforeEach(() => {
  savedEnv = {};
  for (const key of PROXY_ENV_KEYS) savedEnv[key] = process.env[key];
  // No proxy in play: the gzip guard must hold on the plain direct path too.
  for (const key of PROXY_ENV_KEYS) delete process.env[key];

  originalFetch = globalThis.fetch;
  delete globalThis[PROXY_WARN_SEEN];
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  delete globalThis[PROXY_WARN_SEEN];
  for (const key of PROXY_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterAll(() => {
  delete globalThis[PROXY_WARN_SEEN];
  if (typeof globalThis.fetch === "function") {
    delete globalThis.fetch[PATCH_MARK];
    delete globalThis.fetch[INNER_FETCH];
  }
  vi.resetModules();
});

/**
 * An "upstream" that answers with a gzip-encoded JSON body and DOES NOT
 * declare it as transform-safe — exactly what gemini's endpoints serve:
 * content-encoding: gzip, no content-type suffix. The stub stands in for the
 * real (native) fetch so the test drives the patched-fetch boundary itself,
 * the way the Next runtime does, without any network.
 */
function makeGzipUpstreamStub(payload = { ok: true, msg: "DECOMPRESSED-OK" }) {
  const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
  return vi.fn(async () =>
    new Response(gz, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(gz.length),
      },
    }),
  );
}

describe("proxyFetch — gzip responses never reach .json() consumers as raw bytes", () => {
  it("decompresses an upstream gzip JSON body through the patched fetch (regression: DF-9ROUTER-42)", async () => {
    vi.resetModules();
    const stub = makeGzipUpstreamStub();
    globalThis.fetch = stub;
    await import("../../open-sse/utils/proxyFetch.js");

    // The wrapper must be the installed global, exactly like the app runtime.
    expect(globalThis.fetch[PATCH_MARK]).toBe(true);

    const res = await globalThis.fetch("https://generativelanguage.googleapis.com/v1beta/models");
    expect(res.status).toBe(200);

    // The consumer path imageGenerationCore.js:183 / ttsProviders/gemini.js:81
    // takes. Pre-fix this throws: Unexpected token '\u001f' is not valid JSON.
    const json = await res.json();
    expect(json).toEqual({ ok: true, msg: "DECOMPRESSED-OK" });
  });

  it("already-decompressed bodies (undici 7 behaviour) are served byte-identical, no double decompress", async () => {
    vi.resetModules();
    const stub = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    globalThis.fetch = stub;
    await import("../../open-sse/utils/proxyFetch.js");

    const res = await globalThis.fetch("https://api.example.com/v1/models");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("non-gzip content-encoding (br/deflate) bodies are not mangled", async () => {
    vi.resetModules();
    // A brotli body would be garbage if we gzip-decompressed it; the guard
    // must pass it through untouched (undici handles br natively) — the test
    // pins that the guard is scoped to gzip and never rewrites other encodings.
    const fakeBr = Buffer.from("not-actually-brotli");
    const stub = vi.fn(async () =>
      new Response(fakeBr, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-encoding": "br",
        },
      }),
    );
    globalThis.fetch = stub;
    await import("../../open-sse/utils/proxyFetch.js");

    const res = await globalThis.fetch("https://api.example.com/v1/models");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(fakeBr)).toBe(true);
  });
});
