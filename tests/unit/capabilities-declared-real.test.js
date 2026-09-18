import { describe, expect, it } from "vitest";
import {
  getCapabilitiesForModel,
  withDeclaredCapabilities,
} from "../../open-sse/providers/capabilities.js";

// A model added by hand in the dashboard can carry an operator declaration of
// its capabilities (kv `customModels` -> `caps`). The static name-pattern chain
// in getCapabilitiesForModel only sees the model *id*, so it guesses from family
// patterns; the declaration is first-hand knowledge and must win.
//
// Regression: /v1/models and the chatCore modality strip both resolved
// capabilities without consulting the declaration, so a hand-added model the
// operator had marked vision-capable was advertised as text-only and had its
// image blocks stripped before the upstream call.
const RECORDS = [
  { providerAlias: "vendor", id: "flash-v1", caps: { vision: true, reasoning: true } },
  { providerAlias: "vendor", id: "flash-v1(max)", caps: { vision: true, reasoning: true } },
  { providerAlias: "vendor", id: "text-only-v1", caps: { vision: false, reasoning: true } },
  { providerAlias: "vendor", id: "no-declaration" },
];

const declaredById = new Map(
  RECORDS.filter((r) => r.caps).map((r) => [r.id, r.caps])
);

/** Mirrors the resolution the /v1/models route and chatCore both perform. */
function resolveCaps(providerId, modelId) {
  return withDeclaredCapabilities(
    getCapabilitiesForModel(providerId, modelId),
    declaredById.get(modelId)
  );
}

describe("declared capabilities from dashboard records", () => {
  it("honours a declared vision flag that the name pattern would deny", () => {
    // "flash-v1" matches no vision pattern, so the static chain says false.
    const inferred = getCapabilitiesForModel("vendor", "flash-v1");
    expect(inferred.vision).toBe(false);

    expect(resolveCaps("vendor", "flash-v1").vision).toBe(true);
  });

  it("honours a declared vision flag on a suffixed id", () => {
    expect(resolveCaps("vendor", "flash-v1(max)").vision).toBe(true);
  });

  it("does not upgrade a model the operator left text-only", () => {
    expect(resolveCaps("vendor", "text-only-v1").vision).toBe(false);
  });

  it("leaves models with no declaration on the inferred path", () => {
    const inferred = getCapabilitiesForModel("vendor", "no-declaration");
    expect(resolveCaps("vendor", "no-declaration").vision).toBe(inferred.vision);
  });

  it("keeps inferred values for keys the declaration does not mention", () => {
    const caps = resolveCaps("vendor", "flash-v1");
    const inferred = getCapabilitiesForModel("vendor", "flash-v1");
    expect(caps.tools).toBe(inferred.tools);
    expect(caps.contextWindow).toBe(inferred.contextWindow);
  });
});
