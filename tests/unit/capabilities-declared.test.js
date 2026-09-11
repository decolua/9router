import { describe, expect, it } from "vitest";
import {
  getCapabilitiesForModel,
  withDeclaredCapabilities,
} from "../../open-sse/providers/capabilities.js";

// Regression: a model added by hand in the dashboard can carry an operator
// declaration of its capabilities (kv `customModels` -> `caps`). The /v1/models
// route used to resolve capabilities purely from the static name-pattern chain
// and never consult that declaration, so a model the operator had explicitly
// marked vision-capable was advertised as text-only. Clients (and DSH's image
// pipeline) then stripped image blocks before they reached the provider.
describe("withDeclaredCapabilities", () => {
  it("lets a declared vision flag win over a text-only pattern guess", () => {
    // "cbai/deepseek-v4.1-flash" has no vision pattern in the static table.
    const inferred = getCapabilitiesForModel("cbai", "deepseek-v4.1-flash");
    expect(inferred.vision).toBe(false);

    const merged = withDeclaredCapabilities(inferred, { vision: true, reasoning: true });
    expect(merged.vision).toBe(true);
    expect(merged.reasoning).toBe(true);
  });

  it("keeps the inferred values for keys the declaration does not mention", () => {
    const inferred = getCapabilitiesForModel("cbcn", "deepseek-v4.1-flash");
    const merged = withDeclaredCapabilities(inferred, { vision: true });

    expect(merged.vision).toBe(true);
    // Untouched keys still come from the inferred base.
    expect(merged.tools).toBe(inferred.tools);
    expect(merged.contextWindow).toBe(inferred.contextWindow);
  });

  it("ignores unknown keys so a hand-edited kv row cannot inject arbitrary fields", () => {
    const merged = withDeclaredCapabilities({ vision: false }, {
      vision: true,
      __proto__: { polluted: true },
      notACapability: "boom",
    });

    expect(merged.vision).toBe(true);
    expect(merged.notACapability).toBeUndefined();
    expect(merged.polluted).toBeUndefined();
  });

  it("returns the base unchanged when nothing is declared", () => {
    const inferred = getCapabilitiesForModel("cbcn", "deepseek-v4.1-flash");
    expect(withDeclaredCapabilities(inferred, undefined)).toBe(inferred);
    expect(withDeclaredCapabilities(inferred, null)).toBe(inferred);
    expect(withDeclaredCapabilities(inferred, {})).toBe(inferred);
  });

  it("still returns a complete object when the base is missing", () => {
    // Non-LLM kinds resolve no base caps; a declaration must still produce a
    // full capability record rather than a partial one.
    const merged = withDeclaredCapabilities(null, { vision: true });
    expect(merged.vision).toBe(true);
    expect(merged.contextWindow).toBeGreaterThan(0);
    expect(merged.maxOutput).toBeGreaterThan(0);
  });
});
