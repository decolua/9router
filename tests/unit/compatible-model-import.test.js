import { describe, expect, it } from "vitest";
import {
  createCompatibleModelImportPlan,
  formatCompatibleModelImportSummary,
} from "@/shared/utils/compatibleModelImport.js";

describe("compatible model import planning", () => {
  it("plans Venice-style OpenAI-compatible /models responses", () => {
    const result = createCompatibleModelImportPlan([
      { id: "zai-org-glm-5-1", name: "GLM 5.1", type: "text" },
      { id: "qwen-3-7-plus", name: "Qwen 3.7 Plus", type: "text" },
    ], {
      providerStorageAlias: "openai-compatible-venice",
      providerDisplayAlias: "venice",
      modelAliases: {},
    });

    expect(result).toMatchObject({
      fetched: 2,
      skipped: { existing: 0, invalid: 0, conflict: 0 },
      plan: [
        {
          modelId: "zai-org-glm-5-1",
          alias: "zai-org-glm-5-1",
          fullModel: "openai-compatible-venice/zai-org-glm-5-1",
        },
        {
          modelId: "qwen-3-7-plus",
          alias: "qwen-3-7-plus",
          fullModel: "openai-compatible-venice/qwen-3-7-plus",
        },
      ],
    });
  });

  it("reports already imported models instead of treating the import as an opaque failure", () => {
    const result = createCompatibleModelImportPlan([
      { id: "zai-org-glm-5-1" },
    ], {
      providerStorageAlias: "openai-compatible-venice",
      providerDisplayAlias: "venice",
      modelAliases: {
        "zai-org-glm-5-1": "openai-compatible-venice/zai-org-glm-5-1",
      },
    });

    expect(result.plan).toEqual([]);
    expect(result.skipped.existing).toBe(1);
    expect(formatCompatibleModelImportSummary({
      fetched: result.fetched,
      imported: 0,
      failed: 0,
      skipped: result.skipped,
    })).toBe("Fetched 1, added 0, already existed 1");
  });

  it("generates deterministic suffixed aliases when default aliases conflict", () => {
    const result = createCompatibleModelImportPlan([
      { id: "vendor/qwen-3-7-plus" },
      { id: "other/qwen-3-7-plus" },
    ], {
      providerStorageAlias: "openai-compatible-venice",
      providerDisplayAlias: "venice",
      modelAliases: {
        "qwen-3-7-plus": "other-provider/qwen-3-7-plus",
        "venice-qwen-3-7-plus": "old-provider/qwen-3-7-plus",
      },
    });

    expect(result.plan.map((item) => item.alias)).toEqual([
      "venice-qwen-3-7-plus-2",
      "venice-qwen-3-7-plus-3",
    ]);
    expect(result.skipped.conflict).toBe(0);
  });
});
