import { describe, it, expect, vi, beforeEach } from "vitest";

// The free gate keys on the TLS ClientHello: on one process and egress IP the
// same body/headers answered 429 over Node's OpenSSL fingerprint and 200 over
// the cipher list below. These tests pin the wiring, not the upstream.
const { createSessionMock, loadRuntimeDepMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  loadRuntimeDepMock: vi.fn(),
}));

vi.mock("../../open-sse/services/lazyRuntime.js", () => ({
  loadRuntimeDep: loadRuntimeDepMock,
}));

describe("opencodeTlsClient", () => {
  beforeEach(async () => {
    vi.resetModules();
    createSessionMock.mockReset();
    loadRuntimeDepMock.mockReset();
    loadRuntimeDepMock.mockResolvedValue({ createSession: createSessionMock });
  });

  it("uses the cipher list the upstream accepts and sends ALPN-negotiated requests", async () => {
    const response = new Response("data: ok\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch, __test__ } = await import("../../open-sse/services/opencodeTlsClient.js");
    const result = await opencodeTlsFetch("https://opencode.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const options = createSessionMock.mock.calls[0][0];
    expect(options.emulation.tlsOptions.cipherList).toBe(__test__.OPENCODE_CIPHER_LIST);
    // BoringSSL family list: AES-128-GCM first plus the legacy CBC entries the
    // upstream fingerprints on. Dropping any of them is refused upstream.
    expect(__test__.OPENCODE_CIPHER_LIST.split(":")).toHaveLength(17);
    expect(__test__.OPENCODE_CIPHER_LIST.startsWith("TLS_AES_128_GCM_SHA256")).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/inference/v1/chat/completions",
      expect.objectContaining({ method: "POST", body: "{}" })
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("text/event-stream");
  });

  it("reuses one session across requests", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("ok", { status: 200 }));
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/a", {});
    await opencodeTlsFetch("https://opencode.ai/b", {});

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an actionable error when wreq-js is unavailable", async () => {
    loadRuntimeDepMock.mockRejectedValue(new Error("MODULE_NOT_FOUND"));

    const { opencodeTlsFetch, OpencodeTlsUnavailableError } = await import(
      "../../open-sse/services/opencodeTlsClient.js"
    );

    await expect(opencodeTlsFetch("https://opencode.ai/a", {})).rejects.toBeInstanceOf(
      OpencodeTlsUnavailableError
    );
  });

  it("forwards the abort signal so a cancelled stream stops upstream", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("ok", { status: 200 }));
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    const controller = new AbortController();
    await opencodeTlsFetch("https://opencode.ai/a", {}, { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("creates separate sessions per proxy and forwards proxy configuration", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("ok", { status: 200 }));
    createSessionMock.mockResolvedValue({ fetch: fetchMock, close: vi.fn() });

    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");
    await opencodeTlsFetch("https://opencode.ai/a", {}, { proxy: "socks5://127.0.0.1:1080" });
    await opencodeTlsFetch("https://opencode.ai/b", {}, { proxy: "socks5://127.0.0.1:1080" });
    await opencodeTlsFetch("https://opencode.ai/c", {}, { proxy: "socks5://127.0.0.1:1081" });
    await opencodeTlsFetch("https://opencode.ai/d", {});

    expect(createSessionMock).toHaveBeenCalledTimes(3);
    expect(createSessionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ proxy: "socks5://127.0.0.1:1080" })
    );
    expect(createSessionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ proxy: "socks5://127.0.0.1:1081" })
    );
    expect(createSessionMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ proxy: undefined })
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("resets sessions per proxy or all sessions", async () => {
    const close1 = vi.fn();
    const close2 = vi.fn();
    createSessionMock
      .mockResolvedValueOnce({ fetch: vi.fn().mockResolvedValue(new Response("ok")), close: close1 })
      .mockResolvedValueOnce({ fetch: vi.fn().mockResolvedValue(new Response("ok")), close: close2 })
      .mockResolvedValue({ fetch: vi.fn().mockResolvedValue(new Response("ok")), close: vi.fn() });

    const { opencodeTlsFetch, resetOpencodeTlsSession } = await import(
      "../../open-sse/services/opencodeTlsClient.js"
    );
    await opencodeTlsFetch("https://opencode.ai/a", {}, { proxy: "socks5://127.0.0.1:1080" });
    await opencodeTlsFetch("https://opencode.ai/b", {}, { proxy: "socks5://127.0.0.1:1081" });

    // Reset single proxy
    resetOpencodeTlsSession("socks5://127.0.0.1:1080");
    await new Promise((r) => setTimeout(r, 0));
    expect(close1).toHaveBeenCalledTimes(1);
    expect(close2).not.toHaveBeenCalled();

    // Reset all remaining
    resetOpencodeTlsSession();
    await new Promise((r) => setTimeout(r, 0));
    expect(close2).toHaveBeenCalledTimes(1);
  });
});
