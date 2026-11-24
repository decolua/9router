import { describe, expect, it } from "vitest";

import agnes from "../../open-sse/providers/registry/agnes.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";

// Agnes 3.0 Pro (announced 2026-10-05) plus a capability gap that #4398 left
// open: the seeded Agnes ids all fell through to DEFAULT_CAPABILITIES, i.e.
// vision:false / reasoning:false / 200k. Both documented models take text AND
// image URLs, so the router was silently STRIPPING IMAGES from every Agnes
// request. Vendor doc pages: agnes-30-pro and agnes-30-flash.

const caps = (id) => getCapabilitiesForModel("agnes", id);
const ids = () => agnes.models.map((m) => m.id);

describe("agnes-3.0-pro is registered", () => {
  it("is seeded with the dotted id the docs specify", () => {
    // The docs say "Use `agnes-3.0-pro` as the model name" in every sample; the
    // page slug uses dashes, which is only a URL convention.
    expect(ids()).toContain("agnes-3.0-pro");
    expect(ids()).not.toContain("agnes-30-pro");
  });

  it("keeps every previously seeded id", () => {
    for (const id of ["agnes-2.5-flash", "agnes-2.5-pro", "agnes-2.5-pro-beta", "agnes-3.0-flash"]) {
      expect(ids(), id).toContain(id);
    }
  });

  it("has no duplicate ids and every model a name", () => {
    expect(new Set(ids()).size).toBe(ids().length);
    for (const m of agnes.models) expect(m.name.length, m.id).toBeGreaterThan(0);
  });

  it("still relies on passthrough for the un-served ids", () => {
    expect(agnes.passthroughModels).toBe(true);
  });
});

describe("agnes models no longer lose their images (#4398 follow-up)", () => {
  it.each(["agnes-3.0-pro", "agnes-3.0-flash"])("%s claims vision, as documented", (id) => {
    // The regression this guards: DEFAULT_CAPABILITIES.vision is false, so an
    // unrecognised id silently had image blocks stripped before dispatch.
    expect(caps(id).vision, id).toBe(true);
  });

  it.each(["agnes-3.0-pro", "agnes-3.0-flash"])("%s does not fall back to the 200k default", (id) => {
    expect(caps(id).contextWindow, id).toBe(512000);
  });

  it("3.0 Pro is a reasoning model per its doc page", () => {
    expect(caps("agnes-3.0-pro").reasoning).toBe(true);
  });

  it("resolves the same regardless of provider alias", () => {
    // agnes-ai is a declared alias; capabilities.js is keyed on the model, so
    // routing through the alias must not change the answer.
    expect(getCapabilitiesForModel("agnes-ai", "agnes-3.0-pro")).toEqual(caps("agnes-3.0-pro"));
  });

  it("leaves the 2.5 line alone — undocumented limits are not guessed", () => {
    // No vendor figures were published for 2.5 in this change, so those ids keep
    // the default rather than inheriting the 3.0 numbers.
    for (const id of ["agnes-2.5-pro", "agnes-2.5-flash"]) {
      expect(caps(id).contextWindow, id).toBe(200000);
    }
  });
});

describe("agnes-3.0-pro pricing", () => {
  it("carries the published per-1M rates", () => {
    const p = getPricingForModel("agnes", "agnes-3.0-pro");
    expect(p.input).toBe(0.45);
    expect(p.output).toBe(0.90);
  });

  it("prices cache reads at the documented 10% of input", () => {
    const p = getPricingForModel("agnes", "agnes-3.0-pro");
    expect(p.cached).toBeCloseTo(p.input * 0.1, 6);
  });

  it("does not invent a rate for a model with no published price", () => {
    // 3.0 Flash has no published price on its doc page; a fabricated 0 would
    // mis-bill, so it must stay absent.
    expect(getPricingForModel("agnes", "agnes-3.0-flash")).toBeNull();
  });
});
