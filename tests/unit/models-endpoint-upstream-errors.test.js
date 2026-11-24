import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyUpstreamError } from "open-sse/utils/error.js";

// ---------------------------------------------------------------------------
// The classifier itself
// ---------------------------------------------------------------------------

describe("classifyUpstreamError", () => {
  it("maps an aborted request to 504 UPSTREAM_TIMEOUT", () => {
    const err = Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    expect(classifyUpstreamError(err)).toMatchObject({
      status: 504,
      code: "UPSTREAM_TIMEOUT",
    });
  });

  it("maps ETIMEDOUT / undici timeout codes to 504", () => {
    for (const code of ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]) {
      const err = Object.assign(new TypeError("fetch failed"), { cause: { code } });
      expect(classifyUpstreamError(err), code).toMatchObject({ status: 504, code: "UPSTREAM_TIMEOUT" });
    }
  });

  it("maps a refused / unresolved / reset peer to 502 UPSTREAM_UNREACHABLE", () => {
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_SOCKET"]) {
      const err = Object.assign(new TypeError("fetch failed"), { cause: { code } });
      expect(classifyUpstreamError(err), code).toMatchObject({ status: 502, code: "UPSTREAM_UNREACHABLE" });
    }
  });

  it("maps TLS failures to 502 UPSTREAM_UNREACHABLE", () => {
    for (const code of ["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT"]) {
      const err = Object.assign(new Error("tls"), { cause: { code } });
      expect(classifyUpstreamError(err), code).toMatchObject({ status: 502, code: "UPSTREAM_UNREACHABLE" });
    }
  });

  it("keeps an unclassifiable failure at 500 and preserves its message", () => {
    expect(classifyUpstreamError(new Error("model catalog parser exploded"))).toMatchObject({
      status: 500,
      code: "UPSTREAM_FETCH_FAILED",
      message: "model catalog parser exploded",
    });
  });

  it("never throws on a malformed throwable", () => {
    for (const bad of [undefined, null, "boom", 42, {}]) {
      expect(() => classifyUpstreamError(bad)).not.toThrow();
      expect(classifyUpstreamError(bad).status).toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// The route that uses it
// ---------------------------------------------------------------------------

const CONNECTION = {
  id: "conn-1",
  provider: "openai-compatible",
  apiKey: "sk-test",
  providerSpecificData: { baseUrl: "https://upstream.invalid" },
};

async function loadGet() {
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  vi.doMock("@/models", () => ({
    getProviderConnectionById: async () => CONNECTION,
  }));
  vi.doMock("@/shared/constants/providers", () => ({
    isOpenAICompatibleProvider: () => true,
    isAnthropicCompatibleProvider: () => false,
  }));
  const mod = await import("@/app/api/providers/[id]/models/route.js");
  return mod.GET;
}

const call = (GET) =>
  GET(new Request("http://localhost/api/providers/conn-1/models"), {
    params: Promise.resolve({ id: "conn-1" }),
  });

afterEach(() => {
  vi.doUnmock("next/server");
  vi.doUnmock("@/models");
  vi.doUnmock("@/shared/constants/providers");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/providers/[id]/models", () => {
  it("reports an unreachable upstream as 502, not a blanket 500", async () => {
    const GET = await loadGet();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }))
    );

    const res = await call(GET);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      code: "UPSTREAM_UNREACHABLE",
      error: expect.stringContaining("ECONNREFUSED"),
    });
  });

  it("reports an upstream timeout as 504", async () => {
    const GET = await loadGet();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }))
    );

    const res = await call(GET);
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });

  it("still reports a genuine internal failure as 500", async () => {
    const GET = await loadGet();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("catalog parser exploded")));

    const res = await call(GET);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      code: "UPSTREAM_FETCH_FAILED",
      error: "catalog parser exploded",
    });
  });

  it("bounds the wait: the request carries an abort signal", async () => {
    const GET = await loadGet();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await call(GET);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
