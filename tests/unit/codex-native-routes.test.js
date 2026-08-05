import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  relay: vi.fn(),
  getCatalog: vi.fn(),
  refreshUsage: vi.fn(),
  getPoolSnapshot: vi.fn(),
  detectVersion: vi.fn(),
}));

vi.mock("@/lib/codexNative/relay.js", () => ({ relayCodexNativeHttp: mocks.relay }));
vi.mock("@/lib/codexNative/catalog.js", () => ({
  getCodexNativeCatalog: mocks.getCatalog,
  getCodexNativeDefaultModel: vi.fn((catalog) => catalog.models[0]?.slug || null),
}));
vi.mock("@/lib/codexNative/pool.js", () => ({
  refreshCodexNativePoolUsage: mocks.refreshUsage,
  getCodexNativePoolSnapshot: mocks.getPoolSnapshot,
  getCodexNativeMetrics: vi.fn(() => ({ activeLeases: 0 })),
}));
vi.mock("@/lib/codexNative/clientVersion.js", () => ({
  getInstalledCodexClientVersion: mocks.detectVersion,
}));
vi.mock("@/lib/codexNative/clientAuth.js", () => ({
  validateCodexNativeClient: vi.fn(async () => ({ ok: true })),
  codexNativeAuthError: vi.fn(),
}));
vi.mock("open-sse/config/codexNative.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    CODEX_NATIVE_CONFIG: {
      ...actual.CODEX_NATIVE_CONFIG,
      fallbackClientVersion: "0.100.0",
    },
  };
});

describe("Codex Native routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCatalog.mockResolvedValue({
      models: [{ slug: "gpt-native", display_name: "GPT Native" }],
      etag: '"catalog-etag"',
      source: "upstream",
      stale: false,
      clientVersion: "0.146.0",
      fetchedAt: Date.parse("2026-07-31T00:00:00.000Z"),
    });
    mocks.refreshUsage.mockResolvedValue([]);
    mocks.getPoolSnapshot.mockResolvedValue([]);
    mocks.detectVersion.mockResolvedValue({
      installed: true,
      version: "0.146.0",
      raw: "codex-cli 0.146.0",
    });
    mocks.relay.mockResolvedValue(new Response("ok"));
  });

  it("serves the native ModelsResponse and preserves the exact client_version", async () => {
    const { GET } = await import("@/app/api/v1/codex/models/route.js");
    const response = await GET(new Request("http://localhost/v1/codex/models?client_version=next-canary%2Bws"));
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"catalog-etag"');
    expect(response.headers.get("x-models-etag")).toBe('"catalog-etag"');
    expect(mocks.getCatalog).toHaveBeenCalledWith({ clientVersion: "next-canary+ws" });
    await expect(response.json()).resolves.toEqual({
      models: [{ slug: "gpt-native", display_name: "GPT Native" }],
    });
  });

  it("honors If-None-Match", async () => {
    const { GET } = await import("@/app/api/v1/codex/models/route.js");
    const response = await GET(new Request("http://localhost/v1/codex/models?client_version=0.146.0", {
      headers: { "If-None-Match": '"catalog-etag"' },
    }));
    expect(response.status).toBe(304);
    expect(response.headers.get("x-models-etag")).toBe('"catalog-etag"');
  });

  it("returns a clear client error when client_version is missing", async () => {
    const { GET } = await import("@/app/api/v1/codex/models/route.js");
    const response = await GET(new Request("http://localhost/v1/codex/models"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        type: "invalid_request_error",
        code: "missing_client_version",
        message: "client_version is required",
      },
    });
  });

  it("uses the dynamically detected Codex version for the dashboard catalog", async () => {
    const { GET } = await import("@/app/api/cli-tools/codex-native/models/route.js");
    const response = await GET(new Request("http://localhost/api/cli-tools/codex-native/models"));
    expect(response.status).toBe(200);
    expect(mocks.detectVersion).toHaveBeenCalledWith({ forceRefresh: false });
    expect(mocks.getCatalog).toHaveBeenCalledWith({
      forceRefresh: false,
      clientVersion: "0.146.0",
    });
    expect(mocks.getPoolSnapshot).toHaveBeenCalledWith({ clientVersion: "0.146.0" });
    await expect(response.json()).resolves.toMatchObject({
      defaultModel: "gpt-native",
      models: [{ slug: "gpt-native", eligibleAccountCount: 0 }],
      catalog: { clientVersion: "0.146.0" },
    });
  });

  it("uses the compatible catalog version when Codex Desktop cannot run codex --version", async () => {
    mocks.detectVersion.mockResolvedValueOnce({ installed: false, version: null, raw: null });
    const { GET } = await import("@/app/api/cli-tools/codex-native/models/route.js");
    const response = await GET(new Request("http://localhost/api/cli-tools/codex-native/models"));

    expect(response.status).toBe(200);
    expect(mocks.getCatalog).toHaveBeenCalledWith({
      forceRefresh: false,
      clientVersion: "0.100.0",
    });
    expect(mocks.getPoolSnapshot).toHaveBeenCalledWith({ clientVersion: "0.100.0" });
  });

  it.each([
    ["@/app/api/v1/codex/responses/route.js", "responses", "responses"],
    ["@/app/api/v1/codex/responses/compact/route.js", "responses/compact", "compact"],
    ["@/app/api/v1/codex/memories/trace_summarize/route.js", "memories/trace_summarize", "memories"],
    ["@/app/api/v1/codex/alpha/search/route.js", "alpha/search", "search"],
    ["@/app/api/v1/codex/images/generations/route.js", "images/generations", "image-generation"],
    ["@/app/api/v1/codex/images/edits/route.js", "images/edits", "image-edit"],
  ])("maps %s to the native upstream path", async (moduleId, path, operation) => {
    const { POST } = await import(moduleId);
    const request = new Request("http://localhost/native", { method: "POST", body: "{}" });
    await POST(request);
    expect(mocks.relay).toHaveBeenCalledWith(request, expect.objectContaining({ path, operation }));
  });
});
