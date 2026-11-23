import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ node: null, connection: null }));
vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(async () => state.node),
  getProviderConnectionById: vi.fn(async () => state.connection),
  getProviderConnections: vi.fn(async () => []),
  getProviderNodes: vi.fn(async () => []),
  getProxyPoolById: vi.fn(),
  createProviderConnection: vi.fn(async (value) => ({ id: "connection", ...value })),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async () => state.connection),
  updateProviderConnection: vi.fn(),
  getProviderConnections: vi.fn(async () => [state.connection]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: () => true }));

import { POST as create } from "@/app/api/providers/route.js";
import { POST as validate } from "@/app/api/providers/validate/route.js";
import { POST as validateNode } from "@/app/api/provider-nodes/validate/route.js";
import { GET as listModels } from "@/app/api/providers/[id]/models/route.js";
import { testSingleConnection } from "@/app/api/providers/[id]/test/testUtils.js";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { createProviderConnection } from "@/models";

function request(body) {
  return new Request("http://localhost/api/providers", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const headers = new Headers(options?.headers);
    // A stacked upstream rejects any credential header when configured keyless.
    if (state.connection?.apiKey === "" && (headers.has("authorization") || headers.has("x-api-key"))) {
      return new Response("Unexpected credential", { status: 401 });
    }
    return Response.json({ data: [{ id: "discovered-model" }] });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(["openai-compatible", "anthropic-compatible"])("%s explicit empty key", (type) => {
  beforeEach(() => {
    state.node = { id: `${type}-test`, type, name: "Local gateway", prefix: "local", baseUrl: "https://gateway.test/v1", apiType: "chat" };
    state.connection = { id: "connection", provider: state.node.id, apiKey: "", authType: "apikey", isActive: true, providerSpecificData: { ...state.node } };
  });

  it("creates a connection with an explicitly empty key", async () => {
    const response = await create(request({ provider: state.node.id, apiKey: "", name: "Keyless" }));
    expect(response.status).toBe(201);
    expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "", provider: state.node.id }));
  });

  it("still rejects an omitted key", async () => {
    const response = await create(request({ provider: state.node.id, name: "Missing key" }));
    expect(response.status).toBe(400);
  });

  it("validates a saved node without emitting credential headers", async () => {
    const response = await validate(request({ provider: state.node.id, apiKey: "" }));
    expect(await response.json()).toMatchObject({ valid: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks a new node without emitting credential headers", async () => {
    const response = await validateNode(request({ type, baseUrl: state.node.baseUrl, apiKey: "" }));
    expect(await response.json()).toMatchObject({ valid: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to inference without credential headers when /models is unavailable", async () => {
    fetch.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const response = await validateNode(request({ type, baseUrl: state.node.baseUrl, apiKey: "", modelId: "local-model" }));
    expect(await response.json()).toMatchObject({ valid: true, method: "chat" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("lists the upstream models without emitting credential headers", async () => {
    const response = await listModels(request({}), { params: Promise.resolve({ id: "connection" }) });
    expect(await response.json()).toMatchObject({ models: [{ id: "discovered-model" }] });
  });

  it("tests a saved keyless connection successfully", async () => {
    expect(await testSingleConnection("connection")).toMatchObject({ valid: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("discovers keyless upstream models for the public catalog", async () => {
    const models = await buildModelsList(["llm"]);
    expect(models.some((model) => model.id.endsWith("/discovered-model"))).toBe(true);
    expect(fetch).toHaveBeenCalled();
  });

  it("keeps the existing headers when a key is supplied", async () => {
    state.connection.apiKey = "saved-key";
    const response = await validate(request({ provider: state.node.id, apiKey: "saved-key" }));
    expect(await response.json()).toMatchObject({ valid: true });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get("authorization")).toBe("Bearer saved-key");
    if (type === "anthropic-compatible") expect(headers.get("x-api-key")).toBe("saved-key");
  });
});

it.each(["openai", "anthropic", "deepseek"])("continues to require a key for built-in %s", async (provider) => {
  expect((await create(request({ provider, apiKey: "", name: "Empty" }))).status).toBe(400);
  expect((await validate(request({ provider, apiKey: "" }))).status).toBe(400);
});
