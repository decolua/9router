import { describe, it, expect, afterEach, vi } from "vitest";
import {
  normalizeChutesModels,
  parseOpenAIStyleModels,
} from "@/shared/utils/providerModelCatalog";

const originalFetch = globalThis.fetch;

function mockNextResponse() {
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
}

async function importSuggestedModelsRoute() {
  vi.resetModules();
  mockNextResponse();
  return import("@/app/api/providers/suggested-models/route.js");
}

function makeCatalogRequest(params) {
  const url = new URL("https://9router.test/api/providers/suggested-models");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url);
}

afterEach(() => {
  vi.doUnmock("next/server");
  vi.restoreAllMocks();
  vi.resetModules();
  globalThis.fetch = originalFetch;
});

describe("Chutes model catalog helpers", () => {
  it("parses OpenAI-style model envelopes and raw arrays", () => {
    const data = [{ id: "data-model" }];
    const models = [{ id: "models-model" }];
    const results = [{ id: "results-model" }];
    const raw = [{ id: "raw-model" }];

    expect(parseOpenAIStyleModels({ data })).toBe(data);
    expect(parseOpenAIStyleModels({ models })).toBe(models);
    expect(parseOpenAIStyleModels({ results })).toBe(results);
    expect(parseOpenAIStyleModels(raw)).toBe(raw);
    expect(parseOpenAIStyleModels({})).toEqual([]);
  });

  it("normalizes, dedupes, and sorts Chutes models", () => {
    const normalized = normalizeChutesModels({
      data: [
        { id: 123, name: "not valid" },
        { name: "missing id" },
        { id: "zeta/model", name: "Zeta" },
        {
          id: "alpha/model",
          name: "Alpha",
          context_length: 131072,
          owned_by: "chutes",
          pricing: { prompt: "0.01", completion: "0.02", nested: { unit: "token" } },
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
          supported_features: ["tool-calling", { streaming: true }],
        },
        { id: "alpha/model", name: "Duplicate Alpha", context_length: 1 },
        {
          id: "beta",
          contextLength: 8192,
          ownedBy: "community",
          supportedFeatures: { json: true },
        },
      ],
    });

    expect(normalized).toEqual([
      {
        id: "alpha/model",
        name: "Alpha",
        contextLength: 131072,
        ownedBy: "chutes",
        pricing: { prompt: "0.01", completion: "0.02", nested: { unit: "token" } },
        modalities: { input: ["text", "image"], output: ["text"] },
        features: ["tool-calling", { streaming: true }],
      },
      {
        id: "beta",
        name: "beta",
        contextLength: 8192,
        ownedBy: "community",
        features: { json: true },
      },
      { id: "zeta/model", name: "Zeta" },
    ]);
  });
});

describe("suggested-models Chutes catalog route", () => {
  it("returns normalized Chutes models for type=chutes-all", async () => {
    const upstreamUrl = "https://chutes.test/v1/models";
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(url).toBe(upstreamUrl);
      expect(init).toEqual({ cache: "no-store" });
      return new Response(
        JSON.stringify({
          data: [
            { id: "z/model", name: "Zed", context_length: 4096 },
            { id: "a/model", name: "Ay", owned_by: "chutes" },
            { id: null, name: "invalid" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    const { GET } = await importSuggestedModelsRoute();

    const response = await GET(makeCatalogRequest({ url: upstreamUrl, type: "chutes-all" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: [
        { id: "a/model", name: "Ay", ownedBy: "chutes" },
        { id: "z/model", name: "Zed", contextLength: 4096 },
      ],
      error: null,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an error payload for non-OK upstream responses", async () => {
    globalThis.fetch = vi.fn(async () => new Response("upstream error", { status: 503 }));
    const { GET } = await importSuggestedModelsRoute();

    const response = await GET(
      makeCatalogRequest({ url: "https://chutes.test/v1/models", type: "chutes-all" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: [],
      error: "Failed to fetch provider models: 503",
    });
  });

  it("returns 400 for missing params and unknown filters", async () => {
    globalThis.fetch = vi.fn();
    const { GET } = await importSuggestedModelsRoute();

    const missing = await GET(makeCatalogRequest({ type: "chutes-all" }));
    const unknown = await GET(
      makeCatalogRequest({ url: "https://chutes.test/v1/models", type: "nope" })
    );

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "Missing url or type" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "Unknown filter type" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
