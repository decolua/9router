import crypto from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  comboModels: ["provider/model-a", "provider/model-b"],
  connectionModels: ["model-a", "model-b"],
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{
    id: "connection-a",
    provider: "provider",
    isActive: true,
    providerSpecificData: {
      enabledModels: [...state.connectionModels],
      prefix: "provider",
    },
  }],
  getCombos: async () => [{
    name: "coding-pro",
    models: [...state.comboModels],
  }],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));

vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {},
  PROVIDER_ID_TO_ALIAS: {},
  getModelKind: () => "llm",
}));

vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {},
  getProviderAlias: (provider) => provider,
  isAnthropicCompatibleProvider: () => false,
  isOpenAICompatibleProvider: () => false,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => ({}),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: async () => {},
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
}));

import { GET } from "../../src/app/api/v1/models/route.js";

async function modelsResponse(headers = {}) {
  return GET(new Request("http://localhost/v1/models", { headers }));
}

async function comboEntry(response) {
  const payload = await response.json();
  return payload.data.find((model) => model.id === "coding-pro");
}

beforeEach(() => {
  state.comboModels = ["provider/model-a", "provider/model-b"];
  state.connectionModels = ["model-a", "model-b"];
});

const capabilitiesById = {
  "provider/model-a": {
    vision: true,
    tools: true,
    reasoning: true,
    contextWindow: 200000,
    maxOutput: 64000,
  },
  "provider/model-b": {
    vision: false,
    tools: true,
    reasoning: false,
    contextWindow: 120000,
    maxOutput: 32000,
  },
};

async function aggregateCombo(comboModels, comboLookup = {}, resolveCapabilities = (modelId) => capabilitiesById[modelId]) {
  const capabilities = await import("../../open-sse/providers/capabilities.js");
  expect(capabilities.aggregateComboCapabilities).toBeTypeOf("function");
  return capabilities.aggregateComboCapabilities(comboModels, {
    comboLookup,
    resolveCapabilities,
  });
}

describe("proposed safe Combo /v1/models metadata contract", () => {
  it("never exposes Combo membership or a representative physical model", async () => {
    const combo = await comboEntry(await modelsResponse());

    expect(combo).toMatchObject({
      id: "coding-pro",
      object: "model",
      owned_by: "combo",
    });
    expect(combo).not.toHaveProperty("models");
    expect(combo).not.toHaveProperty("members");
    expect(combo).not.toHaveProperty("representativeModel");
  });

  it("projects only capabilities safe across every resolved Combo leaf", async () => {
    const caps = await aggregateCombo(state.comboModels);

    expect(caps).toMatchObject({
      vision: false,
      tools: true,
      reasoning: false,
      contextWindow: 120000,
      maxOutput: 32000,
    });
  });

  it("resolves nested Combos to leaves before applying conservative floors", async () => {
    const caps = await aggregateCombo(["nested-combo"], {
      "nested-combo": ["provider/model-a", "provider/model-b"],
    });

    expect(caps).toMatchObject({
      vision: false,
      tools: true,
      reasoning: false,
      contextWindow: 120000,
      maxOutput: 32000,
    });
  });

  it.each([
    ["cyclic nested membership", ["nested-a"], { "nested-a": ["nested-b"], "nested-b": ["nested-a"] }, undefined],
    ["a missing member", ["provider/missing"], {}, undefined],
    [
      "an unknown capability value",
      ["provider/model-a"],
      {},
      () => ({ ...capabilitiesById["provider/model-a"], vision: "unknown" }),
    ],
  ])("returns no aggregate for %s", async (_label, members, lookup, resolver) => {
    const caps = await aggregateCombo(members, lookup, resolver);
    expect(caps).toBeNull();
  });

  it("omits public aggregate metadata when a Combo member cannot be resolved", async () => {
    state.comboModels = ["provider/missing"];
    const combo = await comboEntry(await modelsResponse());

    expect(combo).not.toHaveProperty("capabilities");
    expect(combo).not.toHaveProperty("contextWindow");
  });

  it("adds conservative public metadata to the logical Combo entry", async () => {
    const combo = await comboEntry(await modelsResponse());

    expect(combo.contextWindow).toBeGreaterThan(0);
    expect(combo.capabilities).toEqual(expect.objectContaining({
      vision: expect.any(Boolean),
      tools: expect.any(Boolean),
      reasoning: expect.any(Boolean),
    }));
  });

  it("returns a strong ETag and honors If-None-Match with 304", async () => {
    const first = await modelsResponse();
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);

    const conditional = await modelsResponse({ "If-None-Match": etag });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(await conditional.text()).toBe("");
  });

  it.each([
    ["a comma-separated validator list", (etag) => `\"unrelated\", ${etag}`],
    ["a weak validator", (etag) => `W/${etag}`],
    ["the wildcard", () => "*"],
  ])("honors If-None-Match with %s", async (_label, headerValue) => {
    const first = await modelsResponse();
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);

    const conditional = await modelsResponse({ "If-None-Match": headerValue(etag) });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(await conditional.text()).toBe("");
  });

  it("canonicalizes equivalent public model ordering to stable bytes and ETag", async () => {
    const first = await modelsResponse();
    const firstBody = await first.text();
    const firstTag = first.headers.get("etag");

    state.connectionModels = ["model-b", "model-a"];
    const second = await modelsResponse();
    const secondBody = await second.text();
    const secondTag = second.headers.get("etag");

    expect(secondBody).toBe(firstBody);
    expect(JSON.parse(secondBody)).toEqual(JSON.parse(firstBody));
    expect(secondTag).toBe(firstTag);
    expect(secondTag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
  });

  it("changes the opaque validator when private routing membership changes", async () => {
    const first = await modelsResponse();
    const firstPayload = await first.clone().json();
    const firstTag = first.headers.get("etag");

    state.comboModels = ["provider/model-b", "provider/model-a"];
    const second = await modelsResponse();
    const secondPayload = await second.clone().json();
    const secondTag = second.headers.get("etag");

    expect(secondPayload).toEqual(firstPayload);
    expect(secondTag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    expect(secondTag).not.toBe(firstTag);
    expect(secondTag).not.toContain("provider/model-a");
    expect(secondTag).not.toContain("provider/model-b");
  });

  it("uses an injectable HMAC key and cannot be reproduced by raw membership hashing", async () => {
    const route = await import("../../src/app/api/v1/models/route.js");
    expect(route.createModelsValidator).toBeTypeOf("function");
    const publicModels = [{ id: "coding-pro", object: "model", owned_by: "combo" }];
    const combos = [{ name: "coding-pro", models: ["provider/model-a", "provider/model-b"] }];
    const keyA = Buffer.from("11".repeat(32), "hex");
    const keyB = Buffer.from("22".repeat(32), "hex");

    const first = route.createModelsValidator({ publicModels, combos, revisionKey: keyA });
    const repeated = route.createModelsValidator({ publicModels, combos, revisionKey: keyA });
    const otherKey = route.createModelsValidator({ publicModels, combos, revisionKey: keyB });
    const dictionaryCandidates = [
      JSON.stringify(publicModels),
      JSON.stringify(combos),
      "provider/model-a",
      "provider/model-b",
      "coding-pro",
    ].map((candidate) => `"sha256:${crypto.createHash("sha256").update(candidate).digest("hex")}"`);

    expect(first).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    expect(repeated).toBe(first);
    expect(otherKey).not.toBe(first);
    expect(first).not.toContain("provider/model-a");
    expect(first).not.toContain("provider/model-b");
    expect(dictionaryCandidates).not.toContain(first);
  });
});
