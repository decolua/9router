// Antigravity Gemini 3.6 picker variants share ONE wire model and pin their effort
// tier. Regression guard for the "404 Requested entity was not found" class: Google
// rejects any model string that is not a real wire id, so a tier id that reaches the
// wire (because the registry never mapped it, or because a "(level)" suffix survived)
// fails with an opaque upstream 404 instead of a routing error.
import { describe, it, expect } from "vitest";
import { PROVIDER_MODELS, getModelUpstreamId, isValidModel } from "open-sse/config/providerModels.js";
import { PROVIDER_MODELS as REGISTRY_MODELS } from "open-sse/providers/index.js";
import { stripThinkingSuffix, parseSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { MITM_TOOLS } from "@/shared/constants/cliTools.js";

const GEMINI_36_WIRE_ID = "gemini-3.6-flash-tiered";
const TIERS = [["gemini-3.6-flash-high", "high"], ["gemini-3.6-flash-medium", "medium"], ["gemini-3.6-flash-low", "low"]];

describe("antigravity gemini-3.6 tiers", () => {
  it.each(TIERS)("%s resolves to the tiered wire model with its pinned level", (id, level) => {
    const upstream = getModelUpstreamId("ag", id);
    expect(stripThinkingSuffix(upstream)).toBe(GEMINI_36_WIRE_ID);
    expect(parseSuffix(upstream).override).toEqual({ mode: "level", level });
  });

  it("lets an explicit client suffix override the pinned tier", () => {
    const upstream = getModelUpstreamId("ag", "gemini-3.6-flash-low(high)");
    expect(stripThinkingSuffix(upstream)).toBe(GEMINI_36_WIRE_ID);
    expect(parseSuffix(upstream).override).toEqual({ mode: "level", level: "high" });
  });

  // The models must come from providers/registry/antigravity.js, not be patched onto
  // PROVIDER_MODELS afterwards: consumers that read the registry directly (CLI package,
  // providers/index.js importers) would otherwise miss them and pass the tier id upstream.
  it.each(TIERS)("%s is declared in the provider registry", (id) => {
    expect(REGISTRY_MODELS.ag.map(m => m.id)).toContain(id);
  });
});

describe("model table integrity", () => {
  // getModelUpstreamId may append a "(level)" thinking suffix, which callers strip via
  // stripThinkingSuffix. A registry id that already carries parens would survive that
  // strip only by luck — and reach the provider verbatim.
  it("no upstreamModelId carries a thinking suffix", () => {
    const offenders = Object.entries(PROVIDER_MODELS).flatMap(([alias, models]) =>
      (models || [])
        .filter(m => /[()]/.test(m?.upstreamModelId || ""))
        .map(m => `${alias}/${m.id} → ${m.upstreamModelId}`)
    );
    expect(offenders).toEqual([]);
  });

  // Advertising a model the router can't map is what turns a config gap into an
  // upstream 404: unknown ids are passed through to the provider verbatim.
  it("every model the Antigravity MITM tool advertises is routable", () => {
    const advertised = new Set([
      ...MITM_TOOLS.antigravity.modelAliases,
      ...MITM_TOOLS.antigravity.defaultModels.map(m => m.id),
    ]);
    const unroutable = [...advertised].filter(id => !isValidModel("ag", id));
    expect(unroutable).toEqual([]);
  });
});
