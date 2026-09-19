import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getApiKeys: vi.fn(),
  getConsistentMachineId: vi.fn(),
  getProviderModels: vi.fn(),
  isOpenAICompatibleProvider: vi.fn(() => true),
  isAnthropicCompatibleProvider: vi.fn(() => false),
  pingModelByKind: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  getApiKeys: mocks.getApiKeys,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("open-sse/config/providerModels.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderModels: mocks.getProviderModels,
}));

vi.mock("@/shared/constants/providers", async (importOriginal) => ({
  ...(await importOriginal()),
  isOpenAICompatibleProvider: mocks.isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider: mocks.isAnthropicCompatibleProvider,
}));

vi.mock("@/app/api/models/test/ping", () => ({
  pingModelByKind: mocks.pingModelByKind,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const { POST } = await import("../../src/app/api/providers/[id]/test-models/route.js");

const originalFetch = global.fetch;
const CLI_TOKEN = "valid-cli-token-value";

function modelsUrl() {
  return expect.stringContaining("/api/providers/conn-node/models");
}

describe("POST /api/providers/[id]/test-models self-fetch credentials (M2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue({ id: "conn-node", provider: "custom-node" });
    mocks.getApiKeys.mockResolvedValue([{ key: "sk-internal", isActive: true }]);
    mocks.getConsistentMachineId.mockResolvedValue(CLI_TOKEN);
    mocks.getProviderModels.mockReturnValue([]);
    mocks.pingModelByKind.mockResolvedValue({ ok: true, latencyMs: 5, error: null, status: 200 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends internal Authorization + valid CLI token headers on the /models self-fetch", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ id: "m1", name: "Model 1" }] }), { status: 200 })
    );

    const req = new Request("http://localhost/api/providers/conn-node/test-models", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "conn-node" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    const selfFetchCall = global.fetch.mock.calls.find(([url]) => String(url).includes("/api/providers/conn-node/models"));
    expect(selfFetchCall, "self-fetch to /models must be attempted").toBeDefined();
    expect(selfFetchCall[1].headers["x-9r-cli-token"]).toBe(CLI_TOKEN);
    expect(selfFetchCall[1].headers["Authorization"]).toBe("Bearer sk-internal");
  });

  it("surfaces an explicit error when the /models self-fetch gets a 401 (no silent empty list)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    const req = new Request("http://localhost/api/providers/conn-node/test-models", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "conn-node" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/401/);
    expect(body.error).not.toMatch(/No models configured/);
    expect(mocks.pingModelByKind).not.toHaveBeenCalled();
  });

  it("surfaces an explicit error when the /models self-fetch throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("socket hang up"));

    const req = new Request("http://localhost/api/providers/conn-node/test-models", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "conn-node" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/socket hang up/);
    expect(body.error).not.toMatch(/No models configured/);
  });

  it("keeps returning 400 'No models configured' when the live list is legitimately empty", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 })
    );

    const req = new Request("http://localhost/api/providers/conn-node/test-models", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "conn-node" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/No models configured/);
    expect(global.fetch).toHaveBeenCalledWith(modelsUrl(), expect.anything());
  });

  it("skips the self-fetch entirely when a static model list exists", async () => {
    mocks.getProviderModels.mockReturnValue([{ id: "static-1", name: "Static 1" }]);
    global.fetch = vi.fn();

    const req = new Request("http://localhost/api/providers/conn-node/test-models", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "conn-node" }) });

    expect(res.status).toBe(200);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
