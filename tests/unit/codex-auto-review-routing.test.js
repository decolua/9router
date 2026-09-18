import { describe, expect, it } from "vitest";

import {
  getDefaultModel,
  getModelQuotaFamily,
  getModelUpstreamId,
  getProviderModels,
} from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";

// Codex CLI's auto-review sends the bare model id "codex-auto-review". Before #1398 it fell
// through prefix inference to the "openai" default and failed with
// "No active credentials for provider: openai".
describe("codex auto-review routing (#1398)", () => {
  it("routes the bare Codex auto-review model to the OAuth Codex provider", async () => {
    await expect(getModelInfoCore("codex-auto-review", {})).resolves.toEqual({
      provider: "codex",
      model: "codex-auto-review",
    });
  });

  it("exposes Codex auto-review as a review-quota Codex model", () => {
    const autoReview = getProviderModels("cx").find(
      (model) => model.id === "codex-auto-review",
    );

    expect(autoReview).toBeTruthy();
    expect(autoReview.name).toBe("Codex Auto Review");
    expect(getModelQuotaFamily("cx", "codex-auto-review")).toBe("review");
  });

  // getModelUpstreamId strips CODEX_REVIEW_SUFFIX from unregistered "cx" ids, which would send
  // "codex-auto" upstream. This model is not a derived review variant, so it must go out verbatim.
  it("forwards the id upstream without stripping the -review suffix", () => {
    expect(getModelUpstreamId("cx", "codex-auto-review")).toBe(
      "codex-auto-review",
    );
  });

  // Registering it must not push it to the front of the cx list — getDefaultModel takes models[0].
  it("does not become the default Codex model", () => {
    expect(getDefaultModel("cx")).not.toBe("codex-auto-review");
  });
});
