import { describe, expect, it } from "vitest";
import { collectBulkTestModelIds } from "../../src/shared/utils/providerModelBulkActions.js";

describe("provider model bulk actions", () => {
  it("collects built-in, kilo, and custom model ids for bulk testing", () => {
    const ids = collectBulkTestModelIds({
      models: [
        { id: "gemini-2.5-pro" },
        { id: "gemini-embedding", type: "embedding" },
      ],
      kiloFreeModels: [
        { id: "gemini-2.5-pro" },
        { id: "gemini-2.5-flash" },
      ],
      modelAliases: {
        "gemini-custom": "gc/gemini-custom",
        "other-provider-model": "xx/other-provider-model",
      },
      providerStorageAlias: "gc",
      providerInfo: {},
      disabledModelIds: [],
    });

    expect(ids).toEqual(["gemini-2.5-pro", "gemini-2.5-flash", "gemini-custom"]);
  });

  it("excludes disabled ids and keeps passthrough custom ids with slashes", () => {
    const ids = collectBulkTestModelIds({
      models: [{ id: "openai/gpt-4.1" }],
      kiloFreeModels: [],
      modelAliases: {
        "claude-3": "or/anthropic/claude-3",
        "gpt-4.1": "or/openai/gpt-4.1",
      },
      providerStorageAlias: "or",
      providerInfo: { passthroughModels: true },
      disabledModelIds: ["openai/gpt-4.1"],
    });

    expect(ids).toEqual(["anthropic/claude-3"]);
  });
});
