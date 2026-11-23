import { afterEach, describe, expect, it } from "vitest";
import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";

afterEach(() => setCatalogSource(null));

describe("native Mistral Large 4 catalog limits", () => {
  it.each(["mistral-large-latest", "mistral-large-4", "mistral-large-4-0"])("pins %s to the authenticated native catalog", (model) => {
    setCatalogSource({ getModalities: () => null, getLimits: () => ({ contextWindow: 256000 }) });
    expect(getCapabilitiesForModel("mistral", model)).toMatchObject({ contextWindow: 1048576, tools: true, vision: true });
  });

  it("does not enlarge older models or resellers", () => {
    expect(getCapabilitiesForModel("mistral", "mistral-large-2411").contextWindow).toBe(256000);
    expect(getCapabilitiesForModel("other-provider", "mistral-large-latest").contextWindow).toBe(256000);
    expect(getCapabilitiesForModel("mistral", "codestral-latest").contextWindow).toBeLessThan(1000000);
  });
});
