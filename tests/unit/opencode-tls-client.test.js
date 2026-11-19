import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
      expect.objectContaining({ method: "POST", body: "{}", timeout: 120_000 })
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

  it("allows sequential header and body waits on the executor's direct path", async () => {
    vi.stubEnv("NO_PROXY", "*");
    vi.stubEnv("STREAM_HEADERS_TIMEOUT_MS", "960000");
    vi.stubEnv("STREAM_FIRST_CHUNK_TIMEOUT_MS", "900000");
    vi.stubEnv("STREAM_STALL_TIMEOUT_MS", "360000");
    vi.stubEnv("STREAM_TERMINAL_GRACE_MS", "0");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Expected the direct TLS adapter")));
    const fetchMock = vi.fn(async () => new Response("data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }));
    createSessionMock.mockResolvedValue({ fetch: fetchMock });
    const { OpenCodeExecutor } = await import("../../open-sse/executors/opencode.js");
    const executor = new OpenCodeExecutor();
    executor.config = { ...executor.config, baseUrl: "http://127.0.0.1:1" };

    const { response } = await executor.execute({
      model: "jev-1.13-free",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      credentials: {},
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1/inference/v1/chat/completions",
      expect.objectContaining({ timeout: 1_860_000 }),
    );
    await expect(response.text()).resolves.toBe("data: [DONE]\n\n");
  });

  it("bounds the combined native timeout", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    createSessionMock.mockResolvedValue({ fetch: fetchMock });
    const { opencodeTlsFetch } = await import("../../open-sse/services/opencodeTlsClient.js");

    await opencodeTlsFetch("https://opencode.ai/a", {}, {
      streamHeadersTimeoutMs: 2 ** 31 - 1,
      streamBodyTimeoutMs: 300_000,
    });

    expect(fetchMock.mock.calls[0][1].timeout).toBe(2 ** 31 - 1);
  });
});
