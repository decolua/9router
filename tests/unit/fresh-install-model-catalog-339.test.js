import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// DF-9ROUTER-2 / df2-model-catalog-t339 — a fresh install (successful provider
// lookup, zero active connections) must not advertise static models whose
// provider still needs credentials: the chat handler answers those with
// 404 "No active credentials for provider", so listing them is a lie. A
// FAILED lookup (DB unavailable) keeps the legacy all-static fail-open list.
//
// DF-9ROUTER-1 — "needs credentials" now also covers providers whose
// credentialless path only works from the vendor's own client
// (`requiresVendorClient: true`, i.e. opencode's free tier): upstream answers
// 200 on /zen/v1/models but 403 FreeTierError on /zen/v1/responses with the
// executor's own header set, so the catalog looked healthy while every
// completion failed.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

const { buildModelsList, GET } = await import("../../src/app/api/v1/models/route.js");
const { GET: GET_MODEL } = await import("../../src/app/api/v1/models/[...model]/route.js");

// Derived from the registry so the expectations track the flags instead of a
// hand-maintained list. `requiresVendorClient` providers are noAuth but NOT
// usable from 9router's own process, so they must not appear here.
const VENDOR_CLIENT_ONLY_ALIASES = new Set(
  Object.values(AI_PROVIDERS)
    .filter((p) => p.requiresVendorClient === true)
    .map((p) => p.alias || p.id),
);
const CREDENTIALLESS_ALIASES = new Set(
  Object.values(AI_PROVIDERS)
    .filter((p) => p.noAuth === true && p.requiresVendorClient !== true)
    .map((p) => p.alias || p.id),
);

// opencode's free tier: noAuth, but only usable from OpenCode's own client.
const VENDOR_CLIENT_ONLY_LLM_MODELS = [
  "oc/muse-spark-1.2-contributor-free",
  "oc/muse-spark-1.3-contributor-free",
];
// Credentialless positive control — edge-tts needs no credentials at all.
const NO_AUTH_TTS_MODEL = "edge-tts/en-US-AriaNeural";
const NO_AUTH_TTS_MODEL_SIBLING = "edge-tts/en-US-GuyNeural";
// A custom model on a genuinely credentialless provider is the only LLM entry a
// fresh install can advertise now that opencode is correctly filtered out.
const NO_AUTH_CUSTOM_MODEL = "edge-tts/et-custom-1";
const CREDENTIALED_LLM_MODELS = [
  "cc/claude-sonnet-5",
  "anthropic/claude-sonnet-4-20250514",
  "deepseek/deepseek-v4-flash",
];

const ids = (models) => models.map((m) => m.id);
const nonCredentiallessIds = (list) =>
  list.filter((id) => !CREDENTIALLESS_ALIASES.has(id.split("/")[0]));

const params = (model) => ({ params: Promise.resolve({ model }) });

async function llmIds() {
  return ids(await buildModelsList(["llm"]));
}

describe("fresh-install model catalog (DF-9ROUTER-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("advertises only credentialless noAuth providers when the lookup succeeds with zero connections", async () => {
    const list = await llmIds();

    for (const credentialed of CREDENTIALED_LLM_MODELS) {
      expect(list).not.toContain(credentialed);
    }
    // Vendor-client-only providers are noAuth but not usable here.
    expect(VENDOR_CLIENT_ONLY_ALIASES.size).toBeGreaterThan(0);
    for (const vendorClientOnly of VENDOR_CLIENT_ONLY_LLM_MODELS) {
      expect(list).not.toContain(vendorClientOnly);
    }
    // Nothing outside the registry-declared usable-without-credentials set may
    // leak through.
    expect(nonCredentiallessIds(list)).toEqual([]);
    // Since upstream v0.5.95 the route resolves UI aliases through
    // ALIAS_TO_PROVIDER_ID (merged with ALIAS_TO_ID), so `mmf` — the UI alias
    // of the hidden, noAuth provider `mimo-free` (Xiaomi's free MiMo channel)
    // — now resolves and its credentialless model legitimately advertises on a
    // fresh install (chat routes it fine: noAuth). Before that fix the alias
    // failed to resolve, the provider was skipped, and this list was empty —
    // the old `toEqual([])` pinned the resolution gap, not a product rule.
    expect(list).toEqual(["mmf/mimo-auto"]);
  });

  it("keeps genuinely credentialless non-LLM providers in zero-connection capability listings", async () => {
    const list = ids(await buildModelsList(["tts"]));

    expect(list).toContain(NO_AUTH_TTS_MODEL);
    expect(nonCredentiallessIds(list)).toEqual([]);
  });

  it("honours disabled-model filtering inside the filtered fresh catalog", async () => {
    mocks.getDisabledModels.mockResolvedValue({ "edge-tts": ["en-US-AriaNeural"] });

    const list = ids(await buildModelsList(["tts"]));

    expect(list).not.toContain(NO_AUTH_TTS_MODEL);
    expect(list).toContain(NO_AUTH_TTS_MODEL_SIBLING);
  });

  it("does not advertise custom models whose provider needs credentials or a vendor client", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { id: "cc-custom-1", providerAlias: "cc" },
      { id: "et-custom-1", providerAlias: "edge-tts" },
      { id: "oc-custom-1", providerAlias: "oc" },
    ]);

    const list = await llmIds();

    expect(list).not.toContain("cc/cc-custom-1");
    expect(list).toContain(NO_AUTH_CUSTOM_MODEL);
    expect(list).not.toContain("oc/oc-custom-1");
  });

  it("treats a stored but inactive connection as zero active connections", async () => {
    mocks.getCustomModels.mockResolvedValue([{ id: "et-custom-1", providerAlias: "edge-tts" }]);
    const fresh = await llmIds();
    expect(fresh).toContain(NO_AUTH_CUSTOM_MODEL);

    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "anthropic", isActive: false },
    ]);

    const list = await llmIds();

    expect(list).toEqual(fresh);
    expect(list).not.toContain("anthropic/claude-sonnet-4-20250514");
  });

  it("keeps the all-static fail-open catalog when the provider lookup throws", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("db unavailable"));

    const list = await llmIds();

    for (const credentialed of CREDENTIALED_LLM_MODELS) {
      expect(list).toContain(credentialed);
    }
    // Fail-open is UNCHANGED: a transient DB error still returns the whole
    // static catalog, vendor-client-only providers included.
    for (const vendorClientOnly of VENDOR_CLIENT_ONLY_LLM_MODELS) {
      expect(list).toContain(vendorClientOnly);
    }
    expect(list.length).toBeGreaterThan(100);
  });

  it("leaves the non-empty active-connection path unchanged", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "anthropic", isActive: true },
    ]);

    const list = await llmIds();

    expect(list).toContain("anthropic/claude-sonnet-4-20250514");
    expect(list).not.toContain("deepseek/deepseek-v4-flash");
    // Upstream #3115 (v0.5.104): no-auth free providers get a virtual
    // "noauth" connection, so their models stay listed even once a real
    // provider is connected — only credential-required providers stay hidden.
    expect(list).toContain("oc/muse-spark-1.2-contributor-free");
  });

  it("GET /v1/models hides credential-required and vendor-client-only static models on a fresh install", async () => {
    const response = await GET(new Request("https://router.test/v1/models"));
    const body = await response.json();
    const list = ids(body.data);

    expect(response.status).toBe(200);
    expect(list).not.toContain("cc/claude-sonnet-5");
    expect(list).not.toContain("oc/muse-spark-1.2-contributor-free");
    expect(nonCredentiallessIds(list)).toEqual([]);
  });

  it("returns 404 for unconfigured credential-required and vendor-client-only models through the exact-model endpoint", async () => {
    mocks.getCustomModels.mockResolvedValue([{ id: "et-custom-1", providerAlias: "edge-tts" }]);

    // List/exact-model parity: the credentialless custom model IS listed, so it
    // resolves.
    const found = await GET_MODEL(
      new Request("https://router.test/v1/models/edge-tts/et-custom-1"),
      params(["edge-tts", "et-custom-1"]),
    );
    expect(found.status).toBe(200);
    expect((await found.json()).id).toBe(NO_AUTH_CUSTOM_MODEL);

    // ...and the flagged provider's model is not listed, so it must not resolve
    // even though the registry marks the provider `noAuth`.
    const vendorClientOnly = await GET_MODEL(
      new Request("https://router.test/v1/models/oc/muse-spark-1.2-contributor-free"),
      params(["oc", "muse-spark-1.2-contributor-free"]),
    );
    expect(vendorClientOnly.status).toBe(404);
    expect((await vendorClientOnly.json()).error.code).toBe("model_not_found");

    const missing = await GET_MODEL(
      new Request("https://router.test/v1/models/cc/claude-sonnet-5"),
      params(["cc", "claude-sonnet-5"]),
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("model_not_found");
  });
});
