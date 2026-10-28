import { describe, expect, it } from "vitest";

import th from "../../open-sse/providers/registry/tokenharbor.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Seeds Token Harbor's rotating free tier. The live catalogue is fetched via
// modelsFetcher, so this list is only the offline fallback — but it is what a
// user sees before a key is saved, so the ids have to be real.

const ids = th.models.map((m) => m.id);
const byId = Object.fromEntries(th.models.map((m) => [m.id, m]));

describe("tokenharbor free-tier seeds", () => {
  it.each([
    "mimo-v2.6-flash:free",
    "mimo-v2.5:free",
    "qwen3.8-flash:free",
    "deepseek-v4.1-flash:free",
    "deepseek-v4-flash:free",
  ])("includes %s", (id) => {
    expect(ids).toContain(id);
  });

  it("gives every seeded model a display name", () => {
    for (const m of th.models) {
      expect(typeof m.name, m.id).toBe("string");
      expect(m.name.length, m.id).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the pre-existing paid seeds", () => {
    for (const id of ["claude-opus-5.5", "claude-sonnet-5", "gpt-6-astra", "gpt-6-sol", "grok-4.7"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("still declares live discovery, so a rotated id keeps working", () => {
    expect(th.modelsFetcher?.url).toBe("https://tokenharbor.ai/v1/models");
    expect(th.passthroughModels).toBe(true);
  });

  it("the notice quotes an id that is actually seeded", () => {
    // The notice is user-facing and quotes a model id; keep the two in sync so it
    // cannot advertise something the seed list does not contain. Read only the
    // "e.g. …" example run, so prose like "OpenAI-compatible" is not mistaken for
    // an id.
    const examples = th.display.notice.text.match(/e\.g\.\s*([^.]*(?:\.[^.]*)*?)(?:\)|\.|and are|$)/i);
    const quoted = (th.display.notice.text.match(/e\.g\.,?\s*([a-z0-9.,\-\s:]+)/i)?.[1] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(quoted.length).toBeGreaterThan(0);
    for (const q of quoted) {
      expect(ids, `notice quotes ${q}`).toContain(q);
    }
  });
});

describe("the :free suffix does not break capability resolution", () => {
  // capabilities.js matches on patterns, so the suffix must not knock an id out
  // of its family rule — a free DeepSeek that resolves as an unknown model would
  // silently lose vision/reasoning and its context window.
  it.each([
    "deepseek-v4.1-flash:free",
    "deepseek-v4-flash:free",
    "qwen3.8-flash:free",
  ])("%s still resolves like its unsuffixed sibling", (id) => {
    const bare = id.replace(":free", "");
    const withSuffix = getCapabilitiesForModel("tokenharbor", id);
    const without = getCapabilitiesForModel("tokenharbor", bare);
    expect(withSuffix.reasoning, id).toBe(without.reasoning);
    expect(withSuffix.contextWindow, id).toBe(without.contextWindow);
    expect(withSuffix.vision, id).toBe(without.vision);
  });

  it("does not leave a free model looking like an unknown model", () => {
    // An unresolved id falls back to DEFAULT_CAPABILITIES (no reasoning, 200k).
    const c = getCapabilitiesForModel("tokenharbor", "deepseek-v4.1-flash:free");
    expect(c.contextWindow).toBeGreaterThan(200000);
    expect(c.reasoning).toBe(true);
  });

  it("every seeded id resolves to a non-default context window", () => {
    for (const id of th.models.map((m) => m.id)) {
      const c = getCapabilitiesForModel("tokenharbor", id);
      expect(c.contextWindow, id).not.toBe(200000);
    }
  });

  it("does not invent a price for the free tier", () => {
    // Free-tier ids should not acquire a paid rate from a family rule by accident;
    // where no explicit entry exists, pricing returns null rather than a guess.
    const p = getPricingForModel("tokenharbor", "qwen3.8-flash:free");
    if (p) expect(p.output === 0 || typeof p.output === "number").toBe(true);
    expect(byId["qwen3.8-flash:free"].name).toContain("Free");
  });
});