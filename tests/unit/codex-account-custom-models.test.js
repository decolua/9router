import { describe, expect, it } from "vitest";

import { mergeCodexCustomModels } from "../../src/app/api/providers/[id]/models/route.js";

describe("Codex account custom model catalog", () => {
  it("merges cx and codex LLM models without duplicates", () => {
    expect(mergeCodexCustomModels(
      [{ id: "gpt-live", name: "GPT Live" }],
      [
        { providerAlias: "cx", id: "gpt-custom", type: "llm", name: "GPT Custom" },
        { providerAlias: "codex", id: "gpt-other", kind: "llm" },
        { providerAlias: "cx", id: "gpt-live", type: "llm", name: "Duplicate" },
        { providerAlias: "ag", id: "gemini-custom", type: "llm" },
        { providerAlias: "cx", id: "image-custom", type: "image" },
      ],
    )).toEqual([
      { id: "gpt-live", name: "GPT Live" },
      { id: "gpt-custom", name: "GPT Custom" },
      { id: "gpt-other", name: "gpt-other" },
    ]);
  });
});
