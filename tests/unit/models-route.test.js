import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(),
}));

vi.mock("@/lib/db/repos/combosRepo.js", () => ({
  getCombos: vi.fn(),
}));

vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/db/repos/aliasRepo.js", () => ({
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/db/repos/disabledModelsRepo.js", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  PROVIDER_ID_TO_ALIAS: {},
  PROVIDER_MODELS: {},
  AI_PROVIDERS: {},
  getProviderAlias: vi.fn().mockReturnValue(null),
  isOpenAICompatibleProvider: vi.fn().mockReturnValue(false),
  isAnthropicCompatibleProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("@/shared/utils/modelCapabilities.js", () => ({
  getCapabilitiesForModel: vi.fn().mockReturnValue(null),
}));

const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
const { getCombos } = await import("@/lib/db/repos/combosRepo.js");
const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo.js");
const { buildModelsList } = await import("@/app/api/v1/models/route.js");

describe("buildModelsList with exposeComboOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("default-off includes Combo and provider model entries", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: false });
    getCombos.mockResolvedValue([
      { name: "my-combo", kind: "llm", models: ["gpt-4"] },
    ]);
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        providerSpecificData: {},
      },
    ]);

    const result = await buildModelsList(["llm"]);

    const comboEntries = result.filter((m) => m.owned_by === "combo");
    const providerEntries = result.filter((m) => m.owned_by !== "combo");

    expect(comboEntries.length).toBeGreaterThan(0);
    expect(providerEntries.length).toBeGreaterThan(0);
  });

  it("enabled returns only kind-matching Combos", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: true });
    getCombos.mockResolvedValue([
      { name: "llm-combo", kind: "llm", models: ["gpt-4"] },
      { name: "web-combo", kind: "webSearch", models: ["search-model"] },
    ]);
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        providerSpecificData: {},
      },
    ]);

    const result = await buildModelsList(["llm"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "llm-combo",
      owned_by: "combo",
    });
  });

  it("enabled with no kind-matching Combo produces empty list", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: true });
    getCombos.mockResolvedValue([
      { name: "web-combo", kind: "webSearch", models: ["search-model"] },
    ]);
    getProviderConnections.mockResolvedValue([
      {
        provider: "openai",
        isActive: true,
        providerSpecificData: {},
      },
    ]);

    const result = await buildModelsList(["llm"]);

    expect(result).toEqual([]);
  });

  it("enabled with web kind filter returns only webSearch/webFetch Combos and preserves kind field", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: true });
    getCombos.mockResolvedValue([
      { name: "llm-combo", kind: "llm", models: ["gpt-4"] },
      { name: "search-combo", kind: "webSearch", models: ["search-model"] },
      { name: "fetch-combo", kind: "webFetch", models: ["fetch-model"] },
    ]);
    getProviderConnections.mockResolvedValue([]);

    const result = await buildModelsList(["webSearch", "webFetch"], { exposeComboOnly: true });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "search-combo",
      owned_by: "combo",
      kind: "webSearch",
    });
    expect(result[1]).toMatchObject({
      id: "fetch-combo",
      owned_by: "combo",
      kind: "webFetch",
    });
    expect(result.every((m) => m.owned_by === "combo")).toBe(true);
    expect(result.every((m) => m.kind === "webSearch" || m.kind === "webFetch")).toBe(true);
  });
});
