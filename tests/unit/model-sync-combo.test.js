import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(async () => ({})),
  getComboByName: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));

import { getComboModels } from "../../src/sse/services/model.js";
import { getComboByName, getProviderConnections } from "@/lib/localDb";

beforeEach(() => {
  vi.clearAllMocks();
  getComboByName.mockImplementation(async () => null);
  getProviderConnections.mockImplementation(async () => []);
});

function catalogConn(provider, models) {
  return { id: `${provider}-1`, provider, isActive: true, modelCatalog: { models, lastSuccessAt: new Date().toISOString(), lastError: null } };
}

describe("combo member filtering against synced catalogs", () => {
  it("keeps the stored combo untouched when nothing is catalogued", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/m1", "orcarouter/m2"] });
    expect(await getComboModels("mix")).toEqual(["bai/m1", "orcarouter/m2"]);
  });

  it("skips a twice-removed member but keeps the saved order of the rest", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/old", "bai/new"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [
        { id: "old", availability: "unavailable", missingSyncs: 2 },
        { id: "new", availability: "available", missingSyncs: 0 },
      ]),
    ]);
    expect(await getComboModels("mix")).toEqual(["bai/new"]);
  });

  it("keeps a member absent only once (temporarily-absent)", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/wobbly"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [{ id: "wobbly", availability: "temporarily-absent", missingSyncs: 1 }]),
    ]);
    expect(await getComboModels("mix")).toEqual(["bai/wobbly"]);
  });

  it("keeps a member when a second account still offers it", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/shared"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [{ id: "shared", availability: "unavailable", missingSyncs: 2 }]),
      catalogConn("bai", [{ id: "shared", availability: "available", missingSyncs: 0 }]),
    ]);
    expect(await getComboModels("mix")).toEqual(["bai/shared"]);
  });

  it("matches gateway-prefixed ids against bare member models", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["orcarouter/claude-sonnet-5"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("orcarouter", [{ id: "anthropic/claude-sonnet-5", availability: "available", missingSyncs: 0 }]),
    ]);
    expect(await getComboModels("mix")).toEqual(["orcarouter/claude-sonnet-5"]);
  });

  it("fails open when every member is confirmed unavailable (the catalog is a hint, not an authority)", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/dead-a", "bai/dead-b"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [
        { id: "dead-a", availability: "unavailable", missingSyncs: 2 },
        { id: "dead-b", availability: "unavailable", missingSyncs: 2 },
      ]),
    ]);
    // Emptying the list would hand handleComboChat zero members and 503 without
    // calling any provider. Route the stored combo and surface the real error.
    expect(await getComboModels("mix")).toEqual(["bai/dead-a", "bai/dead-b"]);
  });

  it("never touches aliases or custom-node prefixes: unresolvable members pass through", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["myalias", "local-qwen/model"] });
    expect(await getComboModels("mix")).toEqual(["myalias", "local-qwen/model"]);
  });

  it("does not treat a failed first sync (empty models, no lastSuccessAt) as a catalog", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["cl/z-ai/glm-5.2"] });
    getProviderConnections.mockResolvedValue([
      { id: "cline-1", provider: "cline", isActive: true, modelCatalog: { models: [], lastError: "network error", lastAttemptAt: new Date().toISOString() } },
    ]);
    expect(await getComboModels("mix")).toEqual(["cl/z-ai/glm-5.2"]);
  });

  it("keeps unlisted passthrough members after a successful Cline catalog sync", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["cl/z-ai/glm-5.2", "cl/anthropic/claude-sonnet-4.6"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("cline", [
        { id: "anthropic/claude-sonnet-4.6", availability: "available" },
        { id: "openai/gpt-5.4", availability: "available" },
      ]),
    ]);
    expect(await getComboModels("mix")).toEqual(["cl/z-ai/glm-5.2", "cl/anthropic/claude-sonnet-4.6"]);
  });

  // Stripping still happens — it just may never empty the combo, so these cases
  // carry a healthy sibling that proves the unavailable member was dropped.
  it("still strips a passthrough member the catalog listed as unavailable", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["cl/anthropic/claude-sonnet-4.6", "cl/openai/gpt-5.4"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("cline", [
        { id: "anthropic/claude-sonnet-4.6", availability: "unavailable", missingSyncs: 2 },
        { id: "openai/gpt-5.4", availability: "available" },
      ]),
    ]);
    expect(await getComboModels("mix")).toEqual(["cl/openai/gpt-5.4"]);
  });

  it("still strips unknown ids on non-passthrough providers (Token Plan)", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["alitp-intl/qwen3.8-max-preview", "alitp-intl/qwen3.8-max"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("alitp-intl", [
        { id: "qwen3.8-max", availability: "available" },
        { id: "qwen3.8-flash", availability: "available" },
      ]),
    ]);
    expect(await getComboModels("mix")).toEqual(["alitp-intl/qwen3.8-max"]);
  });
});
