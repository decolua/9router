import { describe, expect, it } from "vitest";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";

describe("CodeBuddy China model catalog", () => {
  it("resolves the cbcn alias to the China provider", () => {
    expect(PROVIDER_ID_TO_ALIAS["codebuddy-cn"]).toBe("cbcn");
    expect(parseModel("cbcn/glm-5.1")).toMatchObject({
      provider: "codebuddy-cn",
      model: "glm-5.1",
    });
  });

  it("contains only live-smoke verified text-chat models", () => {
    const ids = getModelsByProviderId("codebuddy-cn").map((model) => model.id);

    expect(ids).toHaveLength(15);
    expect(ids).toContain("glm-5.1");
    expect(ids).toContain("minimax-m2.7");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).not.toContain("minimax-m3-play");
    expect(ids).not.toContain("default-model");
  });
});
