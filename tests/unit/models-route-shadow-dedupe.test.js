// A custom-model row created before a model existed in the registry (dashboard
// "add custom model") stores thin caps — {vision, reasoning}, no contextWindow —
// under the UI alias (`ocg|claude-haiku-5-5|llm`). Once the registry gains the
// model, /api/models lists the real entry (fullModel opencode-go/…) AND the
// custom shadow (fullModel ocg/…), both with routedModel ocg/claude-haiku-5-5.
// The client's useModelCaps builds byFull[routedModel] last-write-wins, so the
// shadow (resolved via the alias `ocg`, which misses the provider-scoped 1M
// entry and falls back to *claude*haiku* → 200k/64k) overwrote the real 1M/128k
// caps and dragged every combo containing the seat down to 200k.
//
// Two behaviors pinned here (drive the route handler with mocked repos):
// 1. a custom row whose providerAlias/id collides with a listed routedModel is
//    dropped (read-time filter; the kv row itself is untouched);
// 2. surviving custom rows resolve caps through the provider id, not the alias.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  getModelAliases: vi.fn(async () => ({})),
  setModelAlias: vi.fn(),
  getCustomModels: vi.fn(async () => []),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

import { GET } from "@/app/api/models/route.js";
import { getCustomModels } from "@/models";

function jsonRes(obj) {
  return { json: async () => obj };
}

// The registry list comes from AI_MODELS (static import) — real registry, so
// opencode-go/claude-haiku-5-5 is listed and any ocg/ custom shadow collides.
async function fetchModels() {
  const res = await GET();
  const body = await res.json();
  return body.models || [];
}

beforeEach(() => {
  vi.mocked(getCustomModels).mockClear();
});

describe("/api/models — custom-model shadow dedupe", () => {
  it("drops the ocg/claude-haiku-5-5 shadow and keeps the 1M registry entry", async () => {
    vi.mocked(getCustomModels).mockResolvedValueOnce([
      { providerAlias: "ocg", id: "claude-haiku-5-5", type: "llm", name: "claude-haiku-5-5", caps: { vision: true, reasoning: true } },
    ]);

    const models = await fetchModels();
    const routed = models.filter((m) => m.routedModel === "ocg/claude-haiku-5-5" || m.fullModel === "opencode-go/claude-haiku-5-5");

    expect(routed).toHaveLength(1);
    expect(routed[0].fullModel).toBe("opencode-go/claude-haiku-5-5");
    expect(routed[0].caps.contextWindow).toBe(1000000);
    expect(routed[0].caps.maxOutput).toBe(128000);
  });

  it("keeps non-colliding custom rows and resolves their caps by provider id", async () => {
    vi.mocked(getCustomModels).mockResolvedValueOnce([
      // does not collide: registry has no such id under a routed alias
      { providerAlias: "cmc", id: "some-totally-custom-model", type: "llm", name: "x", caps: {} },
    ]);

    const models = await fetchModels();
    const kept = models.find((m) => m.fullModel === "cmc/some-totally-custom-model");
    expect(kept).toBeDefined();
    // `cmc` maps to commandcode; the commandcode branch (1M/384k for unlisted
    // models) must fire — an alias lookup would miss it entirely and fall to
    // the 200k floor.
    expect(kept.caps.contextWindow).toBe(1000000);
    expect(kept.caps.maxOutput).toBe(384000);
  });
});
