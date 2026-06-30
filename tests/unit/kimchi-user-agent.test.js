import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const proxyFetchMocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyFetchMocks.proxyAwareFetch,
}));

const originalFetch = global.fetch;

describe("Kimchi CLI User-Agent", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("normalizes GitHub release tags into Kimchi CLI User-Agent values", async () => {
    const {
      buildKimchiUserAgent,
      normalizeKimchiCliVersion,
      resetKimchiCliVersionCache,
    } = await import("open-sse/services/kimchiUserAgent.js");

    resetKimchiCliVersionCache();

    expect(normalizeKimchiCliVersion("v0.1.53")).toBe("0.1.53");
    expect(normalizeKimchiCliVersion(" 0.2.0 ")).toBe("0.2.0");
    expect(normalizeKimchiCliVersion("latest")).toBeNull();
    expect(buildKimchiUserAgent("0.1.53")).toBe("kimchi/0.1.53");
  });

  it("resolves the latest Kimchi CLI release and falls back when GitHub is unavailable", async () => {
    const {
      buildKimchiUserAgent,
      refreshKimchiCliVersion,
      resetKimchiCliVersionCache,
    } = await import("open-sse/services/kimchiUserAgent.js");

    resetKimchiCliVersionCache();

    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v0.1.54" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(refreshKimchiCliVersion({ force: true })).resolves.toBe("0.1.54");
    expect(buildKimchiUserAgent()).toBe("kimchi/0.1.54");

    resetKimchiCliVersionCache();
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));

    await expect(refreshKimchiCliVersion({ force: true })).resolves.toBe("0.1.53");
    expect(buildKimchiUserAgent()).toBe("kimchi/0.1.53");
  });

  it("uses the resolved Kimchi CLI User-Agent when fetching live model metadata", async () => {
    const {
      refreshKimchiCliVersion,
      resetKimchiCliVersionCache,
    } = await import("open-sse/services/kimchiUserAgent.js");

    resetKimchiCliVersionCache();

    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v0.1.54" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await refreshKimchiCliVersion({ force: true });

    proxyFetchMocks.proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      models: [
        {
          slug: "minimax-m3",
          display_name: "MiniMax M3",
          provider: "ai-enabler",
          reasoning: false,
          input_modalities: ["text"],
          limits: { context_window: 1048576, max_output_tokens: 65536 },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { resolveKimchiModels } = await import("open-sse/services/kimchiModels.js");
    const result = await resolveKimchiModels({ accessToken: "token" }, { forceRefresh: true });

    expect(result.models.map((m) => m.id)).toEqual(["minimax-m3"]);
    expect(proxyFetchMocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://llm.kimchi.dev/v1/models/metadata?include_in_cli=true",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "kimchi/0.1.54",
        }),
      }),
      null,
    );
  });

  it("refreshes Kimchi CLI version before chat requests and sends that User-Agent upstream", async () => {
    const {
      resetKimchiCliVersionCache,
    } = await import("open-sse/services/kimchiUserAgent.js");

    resetKimchiCliVersionCache();

    global.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: "v0.1.54" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    proxyFetchMocks.proxyAwareFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "OK" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const { KimchiExecutor } = await import("open-sse/executors/kimchi.js");
    const executor = new KimchiExecutor();

    await executor.execute({
      model: "minimax-m3",
      body: { model: "minimax-m3", messages: [{ role: "user", content: "Reply OK only." }] },
      stream: false,
      credentials: { accessToken: "token" },
      signal: undefined,
      log: undefined,
      proxyOptions: null,
    });

    expect(proxyFetchMocks.proxyAwareFetch).toHaveBeenCalledWith(
      "https://llm.kimchi.dev/openai/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": "kimchi/0.1.54",
        }),
      }),
      null,
    );
  });
});
