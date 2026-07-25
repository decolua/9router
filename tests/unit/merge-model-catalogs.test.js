import { describe, expect, it } from "vitest";
import { mergeModelCatalogs } from "../../src/shared/utils/mergeModelCatalogs.js";

describe("mergeModelCatalogs", () => {
  it("keeps static models and adds Copilot live-only models once", () => {
    const staticModels = [
      { id: "gpt-5.2", name: "GPT 5.2" },
      { id: "gpt-4o", name: "Static GPT-4o" },
    ];
    const liveModels = [
      { id: "gpt-4o", name: "Live GPT-4o" },
      { id: "copilot-search-a", name: "Copilot Search A" },
    ];

    expect(mergeModelCatalogs(staticModels, liveModels)).toEqual([
      { id: "gpt-5.2", name: "GPT 5.2" },
      { id: "gpt-4o", name: "Static GPT-4o" },
      { id: "copilot-search-a", name: "Copilot Search A" },
    ]);
  });

  it("ignores catalog rows without a usable model ID", () => {
    expect(mergeModelCatalogs([{ id: "gpt-5.2" }], [{ name: "Missing ID" }, null])).toEqual([
      { id: "gpt-5.2" },
    ]);
  });
});
