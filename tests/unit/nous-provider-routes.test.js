import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOUS_CHAT_COMPLETIONS_URL,
  NOUS_VALIDATION_MODEL,
} from "../../open-sse/services/nous.js";
import { parseModel } from "../../open-sse/services/model.js";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnectionByIdFromModels: vi.fn(),
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
  getProviderConnectionById: mocks.getProviderConnectionByIdFromModels,
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

const makeResponse = (status) => new Response(JSON.stringify({ status }), {
  status,
  headers: { "Content-Type": "application/json" },
});

const makeValidationRequest = () => new Request("http://localhost/api/providers/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "nous", apiKey: "portal-key" }),
});

describe("Nous API-key route wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "nous-connection",
      provider: "nous",
      authType: "apikey",
      apiKey: "portal-key",
      providerSpecificData: {},
    });
    mocks.getProviderConnectionByIdFromModels.mockResolvedValue({
      id: "nous-connection",
      provider: "nous",
      authType: "apikey",
      apiKey: "portal-key",
      providerSpecificData: {},
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("validates a new key through chat rather than the public models endpoint", async () => {
    global.fetch.mockResolvedValue(makeResponse(200));

    const response = await validateProvider(makeValidationRequest());
    const payload = await response.json();

    expect(payload).toEqual({ valid: true, error: null });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(NOUS_CHAT_COMPLETIONS_URL);
    expect(options).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer portal-key",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(options.body)).toMatchObject({
      model: NOUS_VALIDATION_MODEL,
      max_tokens: 1,
      stream: false,
    });
  });

  it("distinguishes rejected keys from inconclusive non-success responses", async () => {
    global.fetch.mockResolvedValueOnce(makeResponse(401));
    const rejected = await validateProvider(makeValidationRequest());
    expect(await rejected.json()).toEqual({
      valid: false,
      error: "Invalid or inactive API key",
    });

    global.fetch.mockResolvedValueOnce(makeResponse(402));
    const paymentRequired = await validateProvider(makeValidationRequest());
    expect(await paymentRequired.json()).toEqual({
      valid: false,
      error: "Unable to verify API key (Nous returned 402)",
    });
  });

  it("does not accept missing models or upstream failures as proof of authentication", async () => {
    global.fetch.mockResolvedValueOnce(makeResponse(404));
    const missingModel = await validateProvider(makeValidationRequest());
    expect(await missingModel.json()).toEqual({
      valid: false,
      error: "Unable to verify API key (Nous returned 404)",
    });

    global.fetch.mockResolvedValueOnce(makeResponse(503));
    const unavailable = await validateProvider(makeValidationRequest());
    expect(await unavailable.json()).toEqual({
      valid: false,
      error: "Unable to verify API key (Nous returned 503)",
    });
  });

  it("uses the same authenticated probe for saved connection tests", async () => {
    global.fetch.mockResolvedValue(makeResponse(200));

    const result = await testSingleConnection("nous-connection");

    expect(result.valid).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      NOUS_CHAT_COMPLETIONS_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer portal-key" }),
      }),
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "nous-connection",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });

  it("marks a saved connection inactive when Nous rejects its key", async () => {
    global.fetch.mockResolvedValue(makeResponse(401));

    const result = await testSingleConnection("nous-connection");

    expect(result).toMatchObject({
      valid: false,
      error: "Invalid or inactive API key",
    });
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "nous-connection",
      expect.objectContaining({
        testStatus: "error",
        lastError: "Invalid or inactive API key",
      }),
    );
  });

  it("lists authenticated text models and filters non-chat catalogue entries", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [
        {
          id: "nousresearch/hermes-4-70b",
          name: "Nous: Hermes 4 70B",
          context_length: 131072,
          architecture: { output_modalities: ["text"] },
        },
        {
          id: "vendor/embedding-model",
          architecture: { output_modalities: ["embeddings"] },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await listProviderModels(
      new Request("http://localhost/api/providers/nous-connection/models"),
      { params: Promise.resolve({ id: "nous-connection" }) },
    );
    const payload = await response.json();

    expect(payload).toMatchObject({
      provider: "nous",
      connectionId: "nous-connection",
      models: [{
        id: "nous/nousresearch/hermes-4-70b",
        name: "Nous: Hermes 4 70B",
        contextLength: 131072,
        upstreamModelId: "nousresearch/hermes-4-70b",
      }],
    });
    expect(parseModel(payload.models[0].id)).toMatchObject({
      provider: "nous",
      model: "nousresearch/hermes-4-70b",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://inference-api.nousresearch.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer portal-key" }),
      }),
    );
  });
});
