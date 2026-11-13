import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel, pickClientCaps } from "../../open-sse/providers/capabilities.js";

// pickClientCaps is the single shape both wire paths use — the /api/models
// payload (src/app/api/models/route.js) and the useModelCaps local fallback
// (src/shared/hooks/useModelCaps.js). The hand-rolled copies used to agree on
// only vision/search/reasoning/limits, so every modality flag was dropped on
// the way to the dashboard and the Audio adapter picker filtered its whole
// candidate list out (#4638).

describe("pickClientCaps", () => {
  it("carries the input modalities the capacity-adapter picker filters on", () => {
    const gemini = pickClientCaps(getCapabilitiesForModel("gemini", "gemini-2.5-flash"));
    expect(gemini).toMatchObject({ vision: true, audioInput: true, videoInput: true });
  });

  it("keeps the payload keys existing dashboard consumers already read", () => {
    const claude = pickClientCaps(getCapabilitiesForModel("anthropic", "claude-sonnet-4.6"));
    expect(Object.keys(claude).sort()).toEqual([
      "audioInput",
      "contextWindow",
      "maxOutput",
      "pdf",
      "reasoning",
      "search",
      "videoInput",
      "vision",
    ]);
    expect(claude.contextWindow).toBeGreaterThan(0);
    expect(claude.maxOutput).toBeGreaterThan(0);
  });

  it("reports a text-only model as lacking every modality", () => {
    const textOnly = pickClientCaps(getCapabilitiesForModel("deepseek", "deepseek-v4-flash"));
    expect(textOnly).toMatchObject({ vision: false, pdf: false, audioInput: false, videoInput: false });
  });

  it("mirrors getCapabilitiesForModel for fields it keeps", () => {
    for (const [provider, model] of [
      ["gemini", "gemini-2.5-flash"],
      ["anthropic", "claude-sonnet-4.6"],
      ["deepseek", "deepseek-v4-flash"],
    ]) {
      const full = getCapabilitiesForModel(provider, model);
      const picked = pickClientCaps(full);
      for (const key of Object.keys(picked)) expect(picked[key]).toEqual(full[key]);
    }
  });
});
