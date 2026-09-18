import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Combo entries in GET /v1/models must carry token-limit metadata.
 *
 * Registry: decolua/9router#3486 — combo-pool models were emitted as bare
 * `{id, object, owned_by}` objects, so any metadata consumer (Cline, Codex,
 * Hermes Agent, ...) fell back to its own guess. A pool whose members all
 * advertise a 1M window was read as ~128k and compacted far too early.
 */
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

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

// getCapabilitiesForModel reports 1M/384k for both of these members.
const MILLION_MEMBER = "ocg/deepseek-v4.1-flash";
const MILLION_MEMBER_2 = "openrouter/deepseek/deepseek-v4-flash";
// A member with no catalog entry: the capability table floors at 200k/64k.
const UNKNOWN_MEMBER = "ghost/does-not-exist";

async function comboEntry(name, models, kind = null) {
  mocks.getCombos.mockResolvedValue([{ id: `id-${name}`, name, kind, models }]);
  const list = await buildModelsList(kind ? [kind] : ["llm"]);
  return list.find((m) => m.id === name);
}

describe("combo entries expose token limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("emits the effective context window of the combo", async () => {
    const combo = await comboEntry("all-million", [MILLION_MEMBER]);

    expect(combo).toBeTruthy();
    expect(combo.owned_by).toBe("combo");
    expect(combo.context_length).toBe(1_000_000);
  });

  it("uses the smallest member window, since the pool cannot exceed it", async () => {
    const combo = await comboEntry("mixed-window", [
      MILLION_MEMBER,
      UNKNOWN_MEMBER, // resolves to the 200k floor
    ]);

    expect(combo.context_length).toBe(200_000);
  });

  it("exposes max_completion_tokens for the pool", async () => {
    const combo = await comboEntry("all-million", [MILLION_MEMBER]);

    expect(combo.max_completion_tokens).toBe(384_000);
  });

  it("never emits a larger window than the members support", async () => {
    const combo = await comboEntry("mixed-window", [MILLION_MEMBER, UNKNOWN_MEMBER]);

    expect(combo.context_length).toBeLessThanOrEqual(1_000_000);
    expect(Number.isFinite(combo.context_length)).toBe(true);
    expect(Number.isFinite(combo.max_completion_tokens)).toBe(true);
  });

  it("accepts member objects as well as plain ids", async () => {
    const combo = await comboEntry("object-members", [
      { model: MILLION_MEMBER },
      { id: MILLION_MEMBER_2 },
    ]);

    expect(combo.context_length).toBe(1_000_000);
  });

  it("keeps web combos free of llm token limits", async () => {
    const combo = await comboEntry("web-search-mix", [MILLION_MEMBER], "webSearch");

    expect(combo.kind).toBe("webSearch");
    expect(combo.context_length).toBeUndefined();
  });

  it("ignores empty member ids instead of crashing", async () => {
    const combo = await comboEntry("has-blanks", ["", "   ", MILLION_MEMBER]);

    expect(combo.context_length).toBe(1_000_000);
  });

  it("still lists a combo whose members carry no metadata at all", async () => {
    const combo = await comboEntry("no-members", []);

    expect(combo).toBeTruthy();
    expect(combo.owned_by).toBe("combo");
  });
});
