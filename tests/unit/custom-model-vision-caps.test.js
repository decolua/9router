import { afterEach, describe, expect, it } from "vitest";

import { getCapabilitiesForModel, setCustomCapsSource } from "../../open-sse/providers/capabilities.js";

// #4301: a custom (OpenAI-compatible / Anthropic-compatible) provider's model
// id is opaque to the built-in catalog, so vision was resolved from the model
// NAME alone. `step-5-preview` matches no vision token, so the request path
// stripped images even though the user marked the model vision-capable in the
// dashboard — the flag only ever reached the /api/models catalog response.

const STEP_MODEL = "step/step-5-preview";
// Custom (OpenAI-compatible) node aliases always carry one of the compatible
// prefixes — see OPENAI_COMPATIBLE_PREFIX in shared/constants/providers.js.
const CUSTOM = "openai-compatible-abc123";
const CUSTOM2 = "openai-compatible-def456";

function declareCaps(caps) {
  setCustomCapsSource({ getCaps: () => caps });
}

afterEach(() => {
  setCustomCapsSource(null);
});

describe("user-declared caps reach the request path (#4301)", () => {
  it("honours a declared vision flag for an unknown custom model", () => {
    declareCaps({ vision: true });
    expect(getCapabilitiesForModel(CUSTOM, STEP_MODEL).vision).toBe(true);
  });

  it("matches the declaration on the bare id as well as the prefixed one", () => {
    const seen = [];
    setCustomCapsSource({
      getCaps: (provider, model) => {
        seen.push(model);
        return model === "step-5-preview" ? { vision: true } : null;
      },
    });
    expect(getCapabilitiesForModel(CUSTOM, STEP_MODEL).vision).toBe(true);
    // The prefixed id is retried as the bare id, so both forms resolve.
    expect(seen).toContain("step-5-preview");
  });

  it("lets a declaration turn vision OFF for a model the heuristic would flag", () => {
    // Opposite direction: a real text-only model whose id happens to contain
    // "vl" must be declarable as text-only, not forced to vision.
    declareCaps({ vision: false });
    expect(getCapabilitiesForModel(CUSTOM, "some-vl-model").vision).toBe(false);
  });

  it("overrides a pattern-matched model (the heuristic has the last word today)", () => {
    // No source installed -> name heuristic still grants vision.
    expect(getCapabilitiesForModel(CUSTOM, "some-vl-model").vision).toBe(true);
    // Declared -> the user's answer wins.
    declareCaps({ vision: false });
    expect(getCapabilitiesForModel(CUSTOM, "some-vl-model").vision).toBe(false);
  });
});

describe("a declaration can never escape the custom-node namespace", () => {
  // Regression guards. A stale or hand-written customModels row must not be
  // able to rewrite a built-in provider's curated table — that would change
  // routing for every request, including ones that use no custom node at all.

  it("does not shadow a built-in provider", () => {
    declareCaps({ vision: false });
    // step-5-preview has no built-in vision, so the built-in result stands.
    expect(getCapabilitiesForModel("anthropic", STEP_MODEL).vision).toBe(false);
    // A model the tables DO give vision to keeps it.
    expect(getCapabilitiesForModel("anthropic", "claude-opus-5.5").vision).toBe(true);
  });

  it("does not shadow a built-in provider's reasoning or limits", () => {
    declareCaps({ reasoning: false, vision: false });
    const caps = getCapabilitiesForModel("anthropic", "claude-opus-5.5");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("claude-adaptive");
    expect(caps.contextWindow).toBe(1000000);
  });

  it("does not shadow commandcode, which returns before the built-in tables", () => {
    // commandcode grants vision by default to any id not on its text-only
    // denylist; a declaration must not reach it.
    declareCaps({ vision: false });
    expect(getCapabilitiesForModel("commandcode", STEP_MODEL).vision).toBe(true);
    // ...and the denylist entry is still honoured.
    expect(getCapabilitiesForModel("commandcode", "stepfun/step-3.5-flash").vision).toBe(false);
  });

  it("is inert when provider is null (no node to attach a declaration to)", () => {
    declareCaps({ vision: true });
    expect(getCapabilitiesForModel(null, STEP_MODEL).vision).toBe(false);
  });
});

describe("declaration is scoped and safe", () => {
  it("only applies to the provider that declared it", () => {
    setCustomCapsSource({ getCaps: (p) => (p === CUSTOM2 ? { vision: true } : null) });
    expect(getCapabilitiesForModel(CUSTOM, STEP_MODEL).vision).toBe(false);
    expect(getCapabilitiesForModel(CUSTOM2, STEP_MODEL).vision).toBe(true);
  });

  it("ignores non-boolean and unknown keys", () => {
    declareCaps({ vision: "yes", thinkingFormat: "claude-adaptive", contextWindow: 999999, nope: true });
    const caps = getCapabilitiesForModel(CUSTOM, STEP_MODEL);
    // "yes" is not a boolean -> ignored, and the pattern-matched default stands.
    expect(caps.vision).toBe(false);
    // thinkingFormat/limits are not declarable; the built-in value is untouched.
    expect(caps.thinkingFormat).toBe("step");
    expect(caps.contextWindow).toBe(128000);
  });

  it("fails open when the lookup throws", () => {
    setCustomCapsSource({
      getCaps: () => {
        throw new Error("db unavailable");
      },
    });
    // Must not strip the data — the resolved result is still complete.
    const caps = getCapabilitiesForModel(CUSTOM, STEP_MODEL);
    expect(caps.vision).toBe(false);
    expect(caps.contextWindow).toBe(128000);
  });

  it("is a no-op when no source is installed (browser bundle)", () => {
    setCustomCapsSource(null);
    expect(getCapabilitiesForModel(CUSTOM, STEP_MODEL).vision).toBe(false);
    // Built-in tables keep working.
    expect(getCapabilitiesForModel("anthropic", "claude-opus-5.5").vision).toBe(true);
  });

  it("uninstalling clears the shared globalThis slot too", () => {
    // Each route chunk carries its own copy of this module, so the reader is
    // published on globalThis. If teardown left it there, the next module copy
    // would resurrect a reader the server had already torn down.
    declareCaps({ vision: true });
    expect(globalThis.__9rCustomCapsSource).toBeTruthy();
    setCustomCapsSource(null);
    expect(globalThis.__9rCustomCapsSource).toBeUndefined();
  });

  it("does not mutate the shared capability tables", () => {
    declareCaps({ vision: false, contextWindow: 1 });
    const a = getCapabilitiesForModel(CUSTOM, "claude-opus-5.5");
    const b = getCapabilitiesForModel(CUSTOM, "claude-opus-5.5");
    expect(a).not.toBe(b);                       // a fresh object each call
    expect(a).toEqual(b);                        // and identical contents
    // The built-in table is untouched.
    expect(getCapabilitiesForModel("anthropic", "claude-opus-5.5").contextWindow).toBe(1000000);
  });
});
