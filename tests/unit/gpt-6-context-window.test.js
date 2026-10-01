import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_ALIASES, build } from "../../src/lib/modelCatalog/sync.js";

// The gpt-6 family's API window is 1.05M. The pattern table published 272,000 for
// it — Kiro's own truncation, copied into the global glob — so every other
// provider's gpt-6 models were advertised at 3.9x under their real window, and a
// client reading context_length compacted (or refused) far too early.
const API_WINDOW = 1050000;
const LEGACY_GPT5_WINDOW = 400000;

describe("gpt-6 / gpt-5.4+ context windows", () => {
  it("reports the 1.05M API window for gpt-6 models on ordinary providers", () => {
    for (const [provider, model] of [
      ["github", "gpt-6-luna"],
      ["azure", "gpt-6-luna"],
      ["openai", "gpt-6-luna"],
      ["github", "gpt-6-sol"],
      ["openai", "gpt-6-astra"],
    ]) {
      expect(getCapabilitiesForModel(provider, model).contextWindow, `${provider}/${model}`).toBe(API_WINDOW);
    }
  });

  // These two gateways really do truncate below the API, and their numbers live in
  // PROVIDER_CAPABILITIES, which outranks the pattern. Correcting the pattern must
  // leave them alone — that split is the whole point of the layering.
  it("leaves the gateways that truncate lower on their own numbers", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-thinking-agentic").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-luna").contextWindow).toBe(272000);
    expect(getCapabilitiesForModel("codex", "gpt-5.6-sol").contextWindow).toBe(372000);
    expect(getCapabilitiesForModel("codex", "gpt-6-astra").contextWindow).toBe(272000);
  });

  it("keeps Devin CLI's seven GPT-5.4/5.5 variants at the gateway's 200k limit", () => {
    for (const model of [
      "gpt-5.4-high", "gpt-5.4-medium", "gpt-5.4-low",
      "gpt-5.5-xhigh", "gpt-5.5-high", "gpt-5.5-medium", "gpt-5.5-low",
    ]) {
      expect(getCapabilitiesForModel("devin-cli", model), model).toMatchObject({
        contextWindow: 200000,
        maxOutput: 128000,
        vision: true,
        reasoning: true,
        thinkingFormat: "openai",
      });
    }
    expect(getCapabilitiesForModel("dv", "gpt-5.5-high").contextWindow).toBe(200000);
    expect(getCapabilitiesForModel("devin", "gpt-5.5-high").contextWindow).toBe(200000);
  });

  // gpt-5.4 is where the 1.05M window starts and the mini/nano tiers are the
  // exception that stayed at 400k. Pattern resolution is first-match-wins, so this
  // is really a guard on the ORDER of the entries: move the tier patterns above
  // the mini/nano ones and both tiers silently report 1.05M.
  it("splits the 1.05M tiers from the 400k ones", () => {
    for (const model of [
      "gpt-5.4", "gpt-5.4-pro", "gpt-5.5", "gpt-5.5-pro", "gpt-5.6", "gpt-5.6-luna", "gpt-5.6-terra",
    ]) {
      expect(getCapabilitiesForModel("openai", model).contextWindow, model).toBe(API_WINDOW);
    }
    for (const model of ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-5.1", "gpt-5.2", "gpt-5.3-codex"]) {
      expect(getCapabilitiesForModel("openai", model).contextWindow, model).toBe(LEGACY_GPT5_WINDOW);
    }
  });
});

// Copilot is "github" locally and "github-copilot" upstream. Without that mapping
// build() resolved no upstream provider for it and skipped every Copilot model, so
// the daily models.dev sync could never correct a stale hand-written number — which
// is how the gpt-6 window stayed 3.9x wrong without anything noticing.
describe("models.dev sync reaches GitHub Copilot", () => {
  it("maps the local github id onto the upstream github-copilot id", () => {
    expect(PROVIDER_ALIASES.github).toBe("github-copilot");
  });

  it("records a Copilot limit that disagrees with the local tables", () => {
    // Copilot caps Claude output at 32k where the local floor assumes 64k.
    const upstream = {
      "github-copilot": {
        models: { "claude-sonnet-4.6": { limit: { context: 200000, output: 32000 } } },
      },
    };
    const entries = [
      { provider: "github", model: "claude-sonnet-4.6", current: { contextWindow: 200000, maxOutput: 64000 } },
    ];

    // Context agrees, so only the output delta is recorded — and it is filed under
    // the local id, which is what the reader looks up.
    expect(build(upstream, entries).providers.github).toEqual({
      "claude-sonnet-4.6": { maxOutput: 32000 },
    });
  });

  it("applies those Copilot deltas to an exact MODEL_CAPABILITIES id", () => {
    // claude-sonnet-4.6 is canonical-exact (128k). Without refine() on that
    // path the 32k Copilot delta from build() would never be read.
    setCatalogSource({
      getModalities: () => null,
      getLimits: (provider, model) =>
        provider === "github" && model === "claude-sonnet-4.6" ? { maxOutput: 32000 } : null,
    });
    try {
      expect(getCapabilitiesForModel("github", "claude-sonnet-4.6").maxOutput).toBe(32000);
      expect(getCapabilitiesForModel("claude", "claude-sonnet-4.6").maxOutput).toBe(128000);
    } finally {
      setCatalogSource(null);
    }
  });
});
