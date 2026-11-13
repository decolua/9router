import { describe, it, expect, vi } from "vitest";
import { applyOpenRouterRouting, normalizeOpenRouterRouting } from "../../open-sse/services/openrouterRouting.js";

const db = vi.hoisted(() => ({ settings: {}, updateSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => db.settings,
  updateSettings: async update => { db.settings = { ...db.settings, ...update }; db.updateSettings(update); },
}));
import { GET, PUT } from "../../src/app/api/providers/[id]/overrides/route.js";

describe("OpenRouter routing policy", () => {
  it("leaves unconfigured requests unchanged", () => {
    const body = { model: "vendor/model" };
    expect(applyOpenRouterRouting(body, null, "completion")).toBe(body);
  });

  it.each(["completion", "embedding", "systemone"])("enforces ZDR and precision on %s without mutation", endpoint => {
    const body = Object.freeze({ provider: Object.freeze({ zdr: false, sort: "latency" }) });
    const policy = { zdr: true, quantizations: ["fp8", "bf16"] };
    expect(applyOpenRouterRouting(body, policy, endpoint).provider).toEqual({ zdr: true, sort: "latency", quantizations: ["fp8", "bf16"] });
    expect(body.provider.zdr).toBe(false);
  });

  it.each(["completion", "embedding", "systemone"])("skips saved precision for proprietary models on %s, retaining ZDR", endpoint => {
    for (const model of ["anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1:nitro", "openai/gpt-5", "openai/chatgpt-4o-latest", "openai/o3", "openai/text-embedding-3-small", "google/gemini-2.5-pro", "x-ai/grok-4.7"]) {
      const body = Object.freeze({ model, provider: Object.freeze({ zdr: false, sort: "latency" }) });
      expect(applyOpenRouterRouting(body, { zdr: true, quantizations: ["bf16"] }, endpoint))
        .toEqual({ model, provider: { zdr: true, sort: "latency" } });
      expect(body.provider).toEqual({ zdr: false, sort: "latency" });
    }
  });

  it("preserves explicit proprietary-model filters without intersecting the saved policy", () => {
    const body = { model: "anthropic/claude-sonnet-4.5", provider: { quantizations: ["unknown"], only: ["anthropic"] } };
    expect(applyOpenRouterRouting(body, { quantizations: ["bf16"], zdr: true }, "completion").provider)
      .toEqual({ quantizations: ["unknown"], only: ["anthropic"], zdr: true });
    expect(applyOpenRouterRouting({ model: body.model }, { quantizations: ["bf16"] }, "completion"))
      .toEqual({ model: body.model });
    expect(() => applyOpenRouterRouting({ model: body.model, provider: { quantizations: [] } }, { quantizations: ["bf16"] }, "completion"))
      .toThrow(/non-empty/);
  });

  it.each(["openai/gpt-oss-120b", "openai/gpt-oss-20b:free", "google/gemma-3-27b-it", "x-ai/grok-1", "deepseek/deepseek-r1", "vendor/claude-copy", "anthropic/other", "openai/gpt-oss", "openai/gpt-oss:free", "vendor/model"])("still enforces precision on %s", model => {
    expect(applyOpenRouterRouting({ model }, { quantizations: ["bf16"] }, "completion").provider)
      .toEqual({ quantizations: ["bf16"] });
    expect(() => applyOpenRouterRouting({ model, provider: { quantizations: ["fp4"] } }, { quantizations: ["bf16"] }, "completion"))
      .toThrow(/conflict/);
  });

  it("exempts only wholly proprietary fallback lists, not mixed or unspecified targets", () => {
    const policy = { quantizations: ["bf16"] };
    const closed = { models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5"] };
    expect(applyOpenRouterRouting(closed, policy, "completion")).toBe(closed);
    for (const body of [
      { models: [] },
      { models: ["anthropic/claude-sonnet-4.5", "openai/gpt-oss-120b"] },
      { model: "openai/gpt-oss-120b", models: closed.models },
      { model: "openrouter/auto" },
      {},
    ]) {
      expect(applyOpenRouterRouting(body, policy, "completion").provider).toEqual(policy);
    }
  });

  it("narrows requested precision with family-aware matching", () => {
    expect(applyOpenRouterRouting({ provider: { quantizations: ["mxfp8", "fp4"] } }, { quantizations: ["fp8"] }, "completion").provider.quantizations).toEqual(["mxfp8"]);
    expect(applyOpenRouterRouting({ provider: { quantizations: ["fp4"] } }, { quantizations: ["nvfp4"] }, "completion").provider.quantizations).toEqual(["nvfp4"]);
    expect(() => applyOpenRouterRouting({ provider: { quantizations: ["fp4"] } }, { quantizations: ["bf16"] }, "completion")).toThrow(/conflict/);
  });

  it.each(["image", "video"])("blocks %s under ZDR unless explicitly excepted", endpoint => {
    const key = endpoint === "image" ? "allowImageWithoutZdr" : "allowVideoWithoutZdr";
    expect(() => applyOpenRouterRouting({}, { zdr: true }, endpoint)).toThrow(/blocked/);
    const body = { model: "vendor/model" };
    expect(applyOpenRouterRouting(body, { zdr: true, [key]: true, quantizations: ["fp8"] }, endpoint)).toBe(body);
    expect(() => applyOpenRouterRouting({ provider: { zdr: true } }, { zdr: true, [key]: true }, endpoint)).toThrow(/blocked/);
  });

  it("preserves inactive exceptions and rejects malformed policy/preferences", () => {
    expect(normalizeOpenRouterRouting({ zdr: false, allowImageWithoutZdr: true })).toEqual({ allowImageWithoutZdr: true });
    for (const value of [[], "bad", { quantizations: [] }, { quantizations: ["fp64"] }, { zdr: "true" }, { unexpected: true }]) {
      expect(() => normalizeOpenRouterRouting(value)).toThrow();
    }
    for (const provider of [[], "bad", { zdr: "true" }, { quantizations: [] }]) {
      expect(() => applyOpenRouterRouting({ provider }, null, "completion")).toThrow();
    }
  });
});

describe("provider override API", () => {
  const context = id => ({ params: Promise.resolve({ id }) });
  const put = (payload, id = "openrouter") => PUT(new Request("http://localhost", { method: "PUT", body: JSON.stringify(payload) }), context(id));

  it("preserves headers on routing saves and routing on header saves/reset", async () => {
    db.settings = { providerOverrides: { openrouter: { headers: { "X-Test": "value" } } } };
    expect((await put({ routing: { zdr: true } })).status).toBe(200);
    expect(db.settings.providerOverrides.openrouter).toEqual({ headers: { "X-Test": "value" }, routing: { zdr: true } });
    await put({ headers: {} });
    expect(db.settings.providerOverrides.openrouter).toEqual({ routing: { zdr: true } });
    expect((await (await GET(null, context("openrouter"))).json()).routing).toEqual({ zdr: true });
    await put({ routing: null });
    expect(db.settings.providerOverrides.openrouter).toBeUndefined();
  });

  it("rejects other providers, malformed JSON and invalid routing without clearing settings", async () => {
    db.settings = { providerOverrides: { openrouter: { routing: { zdr: true } } } };
    expect((await put({ routing: { zdr: true } }, "openai")).status).toBe(400);
    expect((await put({ routing: { quantizations: [] } })).status).toBe(400);
    expect((await PUT(new Request("http://localhost", { method: "PUT", body: "{" }), context("openrouter"))).status).toBe(400);
    expect(db.settings.providerOverrides.openrouter.routing.zdr).toBe(true);
  });
});
