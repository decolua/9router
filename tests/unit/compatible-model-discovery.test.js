import { describe, expect, it } from "vitest";
import { shouldFetchCompatibleModels } from "../../src/shared/utils/compatibleModelDiscovery.js";

describe("shouldFetchCompatibleModels", () => {
  it("does not auto-discover upstream models when custom models define a compatible provider whitelist", () => {
    expect(shouldFetchCompatibleModels({
      isCompatibleProvider: true,
      hasExplicitEnabledModels: false,
      hasConfiguredCustomModels: true,
      skipDynamicFetch: false,
    })).toBe(false);
  });

  it("auto-discovers upstream models when a compatible provider has no configured model list", () => {
    expect(shouldFetchCompatibleModels({
      isCompatibleProvider: true,
      hasExplicitEnabledModels: false,
      hasConfiguredCustomModels: false,
      skipDynamicFetch: false,
    })).toBe(true);
  });

  it("does not auto-discover when a configured enabled-model list or internal fetch disables discovery", () => {
    expect(shouldFetchCompatibleModels({
      isCompatibleProvider: true,
      hasExplicitEnabledModels: true,
      hasConfiguredCustomModels: false,
      skipDynamicFetch: false,
    })).toBe(false);
    expect(shouldFetchCompatibleModels({
      isCompatibleProvider: true,
      hasExplicitEnabledModels: false,
      hasConfiguredCustomModels: false,
      skipDynamicFetch: true,
    })).toBe(false);
  });
});
