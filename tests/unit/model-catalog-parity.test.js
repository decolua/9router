import { expect, it, vi } from "vitest";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []), getCombos: async () => [],
  getModelAliases: async () => ({}), getCustomModels: async () => [
    { providerAlias: "ocg", id: "claude-haiku-5-5", caps: { contextWindow: 123456, maxOutput: 8765 } },
    { providerAlias: "ocg", id: "fixture-custom", caps: { maxOutput: 3333 } },
  ],
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/models", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/sse/services/keyAccess.js", () => ({ getKeyAccessContext: async () => null, filterModelsListForKey: async (_, rows) => rows }));
import { GET as dashboard } from "@/app/api/models/route";
import { GET as publicModels } from "@/app/api/v1/models/route";

it.each([false, true])("every catalog LLM and custom override agrees across both GETs (connected=%s)", async connected => {
  const routes = Object.entries(PROVIDER_ID_TO_ALIAS);
  const fixtures = routes.filter(([, alias]) => PROVIDER_MODELS[alias]?.length);
  db.getProviderConnections.mockResolvedValue(connected ? fixtures.map(([provider, alias]) => ({
    provider, providerSpecificData: { enabledModels: PROVIDER_MODELS[alias].map(m => m.id) },
  })) : []);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
  try {
    const dashboardRows = (await (await dashboard()).json()).models;
    const rows = (await (await publicModels(new Request("http://localhost/v1/models"))).json()).data;
    const lookup = new Map(rows.map(r => [r.id, r]));
    const expected = new Set();
    for (const [provider, alias] of fixtures) {
      if (!(AI_PROVIDERS[provider]?.serviceKinds || ["llm"]).includes("llm")) continue;
      for (const m of PROVIDER_MODELS[alias]) {
        if ((m.type || m.kind || "llm") !== "llm") continue;
        expected.add((connected ? getProviderAlias(provider) : alias) + "/" + m.id);
      }
    }
    expected.add("ocg/fixture-custom");
    const caps = new Map(dashboardRows.flatMap(r => [[r.fullModel, r.caps], [r.routedModel, r.caps]]));
    const missing = [...expected].filter(id => !lookup.has(id) || !caps.has(id));
    expect(missing, JSON.stringify(missing.map(id => [id, lookup.has(id), caps.has(id)]))).toEqual([]);
    for (const id of expected) {
      const { contextWindow, maxOutput } = caps.get(id);
      expect(lookup.get(id), id).toMatchObject({
        capabilities: { contextWindow, maxOutput }, context_length: contextWindow, max_completion_tokens: maxOutput,
      });
    }
    expect(lookup.get("morph/morph-dsv4flash") || lookup.get(getProviderAlias("morph") + "/morph-dsv4flash"))
      .toMatchObject({ context_length: 1048576 });
    const overridden = lookup.get((connected ? "ocg" : "opencode-go") + "/claude-haiku-5-5");
    expect(overridden).toMatchObject({ context_length: 123456, max_completion_tokens: 8765 });
    expect(lookup.get("ocg/fixture-custom").max_completion_tokens).toBe(3333);
  } finally { vi.unstubAllGlobals(); }
});

it("retains live-only limits without letting live metadata contradict shared catalog rows", async () => {
  db.getProviderConnections.mockResolvedValue([{ provider: "opencode" }]);
  const shared = "muse-spark-1.3-contributor-free", liveOnly = "fixture-live-free";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [shared, liveOnly].map(id => ({
    id, limit: { context: 12321, output: 1234 },
  })) })));
  try {
    const rows = (await (await publicModels(new Request("http://localhost/v1/models"))).json()).data;
    const entry = rows.find(r => r.id.endsWith("/" + shared));
    const { caps } = (await (await dashboard()).json()).models.find(r => r.routedModel === entry.id);
    expect(entry).toMatchObject({ context_length: caps.contextWindow, max_completion_tokens: caps.maxOutput });
    expect(rows.find(r => r.id.endsWith("/" + liveOnly))).toMatchObject({ context_length: 12321, max_completion_tokens: 1234 });
  } finally { vi.unstubAllGlobals(); }
});
