import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
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

vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

const originalFetch = global.fetch;
const { POST: validateProvider } = await import("../../src/app/api/providers/validate/route.js");
const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
const { GET: listProviderModels } = await import("../../src/app/api/providers/[id]/models/route.js");

const MODELS_URL = "https://api.hcnsec.cn/v1/models";
const CHAT_URL = "https://api.hcnsec.cn/v1/chat/completions";

const CONNECTION = {
  id: "hcnsec-connection",
  provider: "hcnsec",
  authType: "apikey",
  apiKey: "sk-hcnsec-key",
  providerSpecificData: {},
};

const makeResponse = (status, body = { status }) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const makeValidationRequest = () => new Request("http://localhost/api/providers/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "hcnsec", apiKey: "sk-hcnsec-key" }),
});

describe("HCNSec route wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.getProviderConnectionById.mockResolvedValue({ ...CONNECTION });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("validates a key against the authenticated /v1/models endpoint", async () => {
    global.fetch.mockResolvedValue(makeResponse(200, { data: [] }));

    const response = await validateProvider(makeValidationRequest());
    expect(await response.json()).toEqual({ valid: true, error: null });

    // The generic default branch derives /models from transport.baseUrl; there is
    // no hcnsec-specific case in the validate route.
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(MODELS_URL);
    expect(options.headers).toMatchObject({ Authorization: "Bearer sk-hcnsec-key" });
  });

  it("reports a rejected key as invalid", async () => {
    global.fetch.mockResolvedValue(makeResponse(401, {
      error: { code: "", message: "Invalid token", type: "new_api_error" },
    }));

    const response = await validateProvider(makeValidationRequest());
    expect(await response.json()).toEqual({ valid: false, error: "Invalid API key" });
  });

  it("lists the catalogue from /v1/models with a bearer token", async () => {
    global.fetch.mockResolvedValue(makeResponse(200, {
      data: [
        { id: "auto", object: "model" },
        { id: "glm-5.3", object: "model" },
      ],
    }));

    const response = await listProviderModels(
      new Request("http://localhost/api/providers/hcnsec-connection/models"),
      { params: Promise.resolve({ id: "hcnsec-connection" }) },
    );
    const payload = await response.json();

    expect(payload).toMatchObject({
      provider: "hcnsec",
      connectionId: "hcnsec-connection",
      models: [{ id: "auto" }, { id: "glm-5.3" }],
    });

    // Without the PROVIDER_MODELS_CONFIG entry this route answers 400
    // "does not support models listing", which would break discovery entirely.
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(MODELS_URL);
    expect(options.method).toBe("GET");
    expect(options.headers).toMatchObject({ Authorization: "Bearer sk-hcnsec-key" });
  });

  it("tests a saved connection through the same models endpoint", async () => {
    global.fetch.mockResolvedValue(makeResponse(200, { data: [] }));

    const result = await testSingleConnection("hcnsec-connection");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      MODELS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk-hcnsec-key" }),
      }),
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "hcnsec-connection",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });

  it("never probes the chat lane while validating", async () => {
    global.fetch.mockResolvedValue(makeResponse(200, { data: [] }));

    await validateProvider(makeValidationRequest());
    await testSingleConnection("hcnsec-connection");

    for (const [url] of global.fetch.mock.calls) {
      expect(url).not.toBe(CHAT_URL);
    }
  });
});
