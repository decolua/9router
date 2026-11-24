import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// #4941: every Step-5 route resolved to a 128k context window. The `*step-*`
// pattern pinned contextWindow to 128000 — written when StepFun's line was
// 128k, never updated when Step 5 shipped with 1M. Hand-added custom routes
// (e.g. oc/step-5-preview-free via the customModels kv scope) have no exact
// entry, so this pattern is what they resolve to.
//
// The context window is not cosmetic: capacityAdapter's
// stripHistoryForContext() trims history at 80% of it, and clients probe
// /v1/models and compact against the advertised number — a 8x under-count
// silently discarded context from conversations the model could still hold.

const caps = (id, provider = "oc") => getCapabilitiesForModel(provider, id);

describe("Step 5 is 1M (#4941)", () => {
  it.each(["step-5-preview-free", "step-5-preview"])(
    "%s advertises 1M, not the stale 128k pin",
    (id) => {
      expect(caps(id).contextWindow).toBe(1000000);
    }
  );

  it("resolves through the pattern for a fully-qualified provider/model id", () => {
    expect(caps("oc/step-5-preview-free").contextWindow).toBe(1000000);
  });

  it("resolves the same way for every provider, not just oc", () => {
    for (const p of ["oc", "opencode", "stepfun"]) {
      expect(caps("step-5-preview-free", p).contextWindow, p).toBe(1000000);
    }
  });

  it("keeps the Step thinking format and reasoning intact", () => {
    const c = caps("step-5-preview-free");
    expect(c.thinkingFormat).toBe("step");
    expect(c.reasoning).toBe(true);
  });
});
