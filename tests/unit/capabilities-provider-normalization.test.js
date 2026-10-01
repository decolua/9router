// Regression: getCapabilitiesForModel must resolve the SAME record for a
// provider id and its short alias, and must strip a trailing thinking-level
// suffix. Otherwise the provider-specific override table is missed and the
// looser generic pattern wins — silently reintroducing CodeBuddy CN/Intl
// divergence and wrong max_tokens ceilings.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel provider normalization", () => {
  it("resolves identically for the provider id and its alias", () => {
    const byId = getCapabilitiesForModel("codebuddy-intl", "glm-5.3");
    const byAlias = getCapabilitiesForModel("cbai", "glm-5.3");
    expect(byAlias).toEqual(byId);
    expect(byId.maxOutput).toBe(48000);

    expect(getCapabilitiesForModel("cbcn", "deepseek-v4.1-flash").maxOutput).toBe(
      getCapabilitiesForModel("codebuddy-cn", "deepseek-v4.1-flash").maxOutput
    );
  });

  it("strips a trailing thinking-level suffix before lookup", () => {
    for (const suffix of ["(high)", "(max)", "(8192)", "(none)"]) {
      expect(getCapabilitiesForModel("codebuddy-intl", `glm-5.3${suffix}`).maxOutput).toBe(48000);
    }
  });

  it("still resolves the vendor-prefixed form", () => {
    expect(getCapabilitiesForModel("codebuddy-intl", "vendor/glm-5.3").maxOutput).toBe(48000);
  });
});
