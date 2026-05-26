import { describe, expect, it } from "vitest";

import {
  getModelQuotaFamily,
  getModelUpstreamId,
  getProviderModels,
} from "../../open-sse/config/providerModels.js";

describe("Codex provider GPT-5.5/GPT-5.4 effort variants", () => {
  const models = getProviderModels("cx");
  const modelIds = new Set(models.map((model) => model.id));

  it("includes the target base models", () => {
    expect(modelIds.has("gpt-5.5")).toBe(true);
    expect(modelIds.has("gpt-5.4")).toBe(true);
  });

  it.each(["gpt-5.5", "gpt-5.4"])(
    "generates xhigh, high, medium, and low variants for %s",
    (baseModelId) => {
      expect(modelIds.has(`${baseModelId}-xhigh`)).toBe(true);
      expect(modelIds.has(`${baseModelId}-high`)).toBe(true);
      expect(modelIds.has(`${baseModelId}-medium`)).toBe(true);
      expect(modelIds.has(`${baseModelId}-low`)).toBe(true);
    },
  );

  it("does not generate none variants for GPT-5.5 or GPT-5.4", () => {
    expect(modelIds.has("gpt-5.5-none")).toBe(false);
    expect(modelIds.has("gpt-5.4-none")).toBe(false);
  });

  it("does not generate medium effort variants for non-target base models", () => {
    expect(modelIds.has("gpt-5.2-medium")).toBe(false);
    expect(modelIds.has("gpt-5.3-codex-medium")).toBe(false);
  });

  it("includes generated review variants for effort variants", () => {
    expect(modelIds.has("gpt-5.5-xhigh-review")).toBe(true);
    expect(modelIds.has("gpt-5.5-medium-review")).toBe(true);
  });

  it("preserves effort suffixes when resolving Codex review upstream model IDs", () => {
    expect(getModelUpstreamId("cx", "gpt-5.5-medium-review")).toBe("gpt-5.5-medium");
  });

  it("marks Codex review variants with the review quota family", () => {
    expect(getModelQuotaFamily("cx", "gpt-5.5-medium-review")).toBe("review");
  });
});
