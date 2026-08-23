import { describe, expect, it } from "vitest";
import {
  createModelMappingMap,
  deriveMappedModelName,
  findMappedCandidates,
  getMappedModelName,
} from "@/shared/utils/modelMapping.js";

describe("model mapping", () => {
  const models = [
    { provider: "openrouter", upstreamModel: "anthropic/claude-sonnet-4.6" },
    { provider: "anthropic", upstreamModel: "claude-sonnet-4-6" },
  ];
  const mappings = [
    { ...models[0], mappedModel: "claude-sonnet" },
    { ...models[1], mappedModel: "claude-sonnet" },
  ];

  it("uses identity mapping by default", () => {
    expect(getMappedModelName(createModelMappingMap([]), "openrouter", "openai/gpt-5.4"))
      .toBe("openai/gpt-5.4");
  });

  it("unifies multiple provider models under one mapped name", () => {
    expect(findMappedCandidates(models, mappings, "claude-sonnet")).toEqual(models);
  });

  it("derives the suffix after the final slash", () => {
    expect(deriveMappedModelName("vendor/family/model-name")).toBe("model-name");
    expect(deriveMappedModelName("model-name")).toBe("model-name");
  });
});
