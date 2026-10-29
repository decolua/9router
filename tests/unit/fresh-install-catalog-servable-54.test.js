import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";

// DF-9ROUTER-54 C1 — verify the zero-connection /v1/models contract from the
// side that actually decides whether a chat request can be served: the
// credentialless injection in src/sse/services/auth.js, which hands out a
// virtual "Public" connection for FREE_PROVIDERS[providerId].noAuth === true
// and returns null (-> chat 404) for everything else.
//
// fresh-install-model-catalog-339.test.js already pins the filtering against
// AI_PROVIDERS.noAuth. This file adds the cross-artifact half: every id a fresh
// install advertises must be one the CHAT path can serve with no stored
// connection, derived from FREE_PROVIDERS (the registry category the auth layer
// reads) rather than from the catalog's own helper. If those two ever drift,
// the catalog advertises a model that 404s — the exact defect this board row
// exists to close.

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

const ids = (models) => models.map((m) => m.id);

// The auth layer's own predicate: FREE_PROVIDERS is byCategory("free"), and
// requiresVendorClient providers are noAuth but unusable from this process
// (see providerIsUsableWithoutCredentials in the models route).
function servableWithoutConnection(alias) {
  const entry = FREE_PROVIDERS[resolveProviderId(alias)];
  return entry?.noAuth === true && entry.requiresVendorClient !== true;
}

async function llmIds() {
  return ids(await buildModelsList(["llm"]));
}

describe("zero-connection /v1/models advertises only chat-servable providers (DF-9ROUTER-54 C1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("resolves every advertised model's provider to a credentialless, process-usable provider", async () => {
    const list = await llmIds();

    // A fresh install still has something to call — the filter must not empty
    // the catalog (upstream's free MiMo channel is genuinely noAuth).
    expect(list.length).toBeGreaterThan(0);

    for (const id of list) {
      const alias = id.split("/")[0];
      expect(
        servableWithoutConnection(alias),
        `${id} is advertised on a fresh install but ${resolveProviderId(alias)} is not servable without a connection`,
      ).toBe(true);
    }
  });

  it("is a strict subset of the fail-open catalog — no invented models, and far smaller than the full catalog", async () => {
    // Fail-open state = a FAILED provider lookup, which keeps the legacy
    // all-static catalog. Deriving the comparison from the code's own two
    // states avoids hardcoding a catalog size that drifts every release.
    mocks.getProviderConnections.mockRejectedValue(new Error("db unavailable"));
    const failOpen = await llmIds();

    mocks.getProviderConnections.mockResolvedValue([]);
    const fresh = await llmIds();

    const failOpenSet = new Set(failOpen);
    for (const id of fresh) {
      expect(failOpenSet.has(id), `${id} is not part of the static catalog`).toBe(true);
    }
    // The filtered catalog is a fraction of the unfiltered one: the point of
    // the row is that a fresh install no longer lists the whole static set
    // (the ~691-model catalog) and then 404s on almost all of it.
    expect(fresh.length * 5).toBeLessThan(failOpen.length);
  });

  it("hides credential-required and vendor-client-only models from a fresh install, through GET /v1/models", async () => {
    const response = await GET(new Request("https://router.test/v1/models"));
    const list = ids((await response.json()).data);

    expect(response.status).toBe(200);
    for (const id of list) {
      expect(servableWithoutConnection(id.split("/")[0])).toBe(true);
    }
    // Named controls: a credential-required model and a noAuth-but-vendor-client
    // model are both absent from what a fresh install is told to call.
    expect(list).not.toContain("anthropic/claude-sonnet-4-20250514");
    expect(list).not.toContain("cc/claude-sonnet-5");
    expect(list).not.toContain("oc/muse-spark-1.2-contributor-free");
  });
});
