import { describe, expect, it } from "vitest";

import { finalizeModelsForResponse } from "@/app/api/v1/models/route.js";
import { createModelMappingMap } from "@/shared/utils/modelMapping.js";

describe("models route model metadata", () => {
  it("keeps the provider-qualified route when the public id is mapped", () => {
    const models = [{
      id: "ocg/deepseek-v4-pro",
      object: "model",
      owned_by: "ocg",
      upstream_provider: "opencode-go",
      upstream_model: "deepseek-v4-pro",
    }];

    expect(finalizeModelsForResponse(models, createModelMappingMap([]))).toEqual([{
      id: "deepseek-v4-pro",
      route_model: "ocg/deepseek-v4-pro",
      object: "model",
      owned_by: "ocg",
    }]);
  });

  it("keeps an explicitly mapped public id separate from its route id", () => {
    const models = [{
      id: "ocg/deepseek-v4-pro",
      object: "model",
      owned_by: "ocg",
      upstream_provider: "opencode-go",
      upstream_model: "deepseek-v4-pro",
    }];
    const mappings = createModelMappingMap([{
      provider: "opencode-go",
      upstreamModel: "deepseek-v4-pro",
      mappedModel: "coding-pro",
    }]);

    expect(finalizeModelsForResponse(models, mappings)[0]).toMatchObject({
      id: "coding-pro",
      route_model: "ocg/deepseek-v4-pro",
      owned_by: "ocg",
    });
  });
});
