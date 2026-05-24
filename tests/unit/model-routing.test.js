import { describe, expect, it } from "vitest";

import { getProviderModels, getModelQuotaFamily } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";

describe("model routing", () => {
  it("routes bare Codex auto-review model to Codex OAuth (#1398)", async () => {
    const modelInfo = await getModelInfoCore("codex-auto-review", {});

    expect(modelInfo).toEqual({
      provider: "codex",
      model: "codex-auto-review",
    });
  });

  it("exposes Codex auto-review as a review-quota Codex model", () => {
    const models = getProviderModels("cx");
    const autoReview = models.find((model) => model.id === "codex-auto-review");

    expect(autoReview).toBeTruthy();
    expect(autoReview.name).toBe("Codex Auto Review");
    expect(getModelQuotaFamily("cx", "codex-auto-review")).toBe("review");
  });
});
