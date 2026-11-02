import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// #4544: GLM-5.3 advertised a 200k context. The `*glm-5.3*` pattern pinned
// contextWindow to 200000 (inherited from the pre-5.2 era when z.ai's whole
// line was 200k), and it runs ABOVE the `*glm-5*` catch-all — so it, not the
// catch-all, was what every 5.3 id actually resolved to.
//
// The context window is not cosmetic: capacityAdapter's
// stripHistoryForContext() trims conversation history at 80% of it, so a 5x
// under-count silently discarded history from conversations the model could
// still hold.

const caps = (id, provider = "zai") => getCapabilitiesForModel(provider, id);

describe("GLM 5.2/5.3 are 1M (#4544)", () => {
  it.each([
    "glm-5.3",
    "glm-5.3-flash",
    "glm-5.3-highspeed",
    "glm-5.3-prime",
  ])("%s advertises 1M, not the stale 200k pin", (id) => {
    expect(caps(id).contextWindow).toBe(1000000);
  });

  it("glm-5.2 is 1M too — the same stale pin applied to it", () => {
    expect(caps("glm-5.2").contextWindow).toBe(1000000);
  });

  it("resolves the same way for every provider, not just zai", () => {
    for (const p of ["zai", "glm-cn"]) {
      expect(caps("glm-5.3", p).contextWindow, p).toBe(1000000);
    }
  });

  it.each(["glm-5.1", "glm-5-turbo", "glm-5v-turbo", "glm-5", "glm-5.0"])(
    "%s keeps its real ~200k window",
    (id) => {
      // Guard against "fixing" the catch-all. models.dev lists these across
      // many resellers at 163k-205k, so 200000 is correct for exactly these.
      expect(caps(id).contextWindow).toBe(200000);
    }
  );

  it("still does not gate reasoning_effort for the pre-5.2 models", () => {
    // The comment above the pattern block is explicit about this: z.ai reads
    // reasoning_effort only from 5.2 onward, so 5.1/5-turbo must not claim it.
    for (const id of ["glm-5.1", "glm-5-turbo", "glm-5"]) {
      expect(caps(id).thinkingEffortSupported, id).toBeFalsy();
    }
  });
});