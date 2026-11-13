import { describe, expect, it } from "vitest";
import { applyQoderModelNames, getProviderCustomModelRows } from "@/shared/utils/providerCustomModels.js";

describe("Qoder model display names", () => {
  const models = [{ id: "qmodel_latest", name: "Qwen3.7-Max", contextLength: 200000 }];

  it("uses the saved upstream name without changing IDs or capabilities", () => {
    const saved = [{ providerAlias: "qdcn", id: "qmodel_latest", name: "Qwen4-Max-Preview", type: "llm" }];
    expect(applyQoderModelNames(models, saved, "qdcn")).toEqual([
      { ...models[0], name: "Qwen4-Max-Preview" },
    ]);
    expect(models[0].name).toBe("Qwen3.7-Max");
    expect(getProviderCustomModelRows({ customModels: saved, providerAlias: "qdcn", builtInModels: models })).toEqual([]);
  });

  it("updates existing names on the next fetch", () => {
    for (const providerAlias of ["qd", "qdcn"]) {
      const saved = [{ providerAlias, id: "qmodel_latest", name: "Qwen4-Max-Preview" }];
      expect(applyQoderModelNames(models, saved, providerAlias)[0].name).toBe("Qwen4-Max-Preview");
      saved[0].name = "New upstream name";
      expect(applyQoderModelNames(models, saved, providerAlias)[0].name).toBe("New upstream name");
    }
  });

  it("ignores other providers, modalities and old ID-only records", () => {
    const saved = [
      { providerAlias: "qd", id: "qmodel_latest", name: "Intl model" },
      { providerAlias: "qdcn", id: "qmodel_latest", name: "Audio model", type: "tts" },
      { providerAlias: "qdcn", id: "qmodel_latest", name: "qmodel_latest" },
    ];
    expect(applyQoderModelNames(models, saved, "qdcn")).toEqual(models);
    expect(applyQoderModelNames(models, saved, "other")).toBe(models);
  });
});

describe("provider custom model rows", () => {
  it("keeps identical model IDs separate per provider", () => {
    const customModels = [
      { providerAlias: "ollama", id: "minimax-m2.5", type: "llm", name: "MiniMax M2.5" },
      { providerAlias: "opencode-go", id: "minimax-m2.5", type: "llm", name: "MiniMax M2.5" },
    ];

    expect(getProviderCustomModelRows({ customModels, providerAlias: "ollama" })).toEqual([
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        fullModel: "ollama/minimax-m2.5",
        source: "custom",
        type: "llm",
      },
    ]);
    expect(getProviderCustomModelRows({ customModels, providerAlias: "opencode-go" })).toEqual([
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5",
        fullModel: "opencode-go/minimax-m2.5",
        source: "custom",
        type: "llm",
      },
    ]);
  });

  it("keeps legacy alias-backed models visible without duplicating custom models", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "ollama", id: "custom-a", type: "llm", name: "Custom A" },
      ],
      modelAliases: {
        "custom-a": "ollama/custom-a",
        "legacy-b": "ollama/legacy-b",
        "other-provider": "opencode-go/legacy-b",
      },
      providerAlias: "ollama",
    });

    expect(rows).toEqual([
      {
        id: "custom-a",
        name: "Custom A",
        fullModel: "ollama/custom-a",
        source: "custom",
        type: "llm",
      },
      {
        id: "legacy-b",
        alias: "legacy-b",
        fullModel: "ollama/legacy-b",
        source: "legacyAlias",
        type: "llm",
      },
    ]);
  });

  it("filters built-in models and typed custom models", () => {
    const rows = getProviderCustomModelRows({
      customModels: [
        { providerAlias: "ollama", id: "llama3", type: "llm", name: "Llama 3" },
        { providerAlias: "ollama", id: "custom-image", type: "image", name: "Custom Image" },
        { providerAlias: "ollama", id: "custom-llm", type: "llm", name: "Custom LLM" },
      ],
      providerAlias: "ollama",
      builtInModels: [{ id: "llama3" }],
      type: "llm",
    });

    expect(rows).toEqual([
      {
        id: "custom-llm",
        name: "Custom LLM",
        fullModel: "ollama/custom-llm",
        source: "custom",
        type: "llm",
      },
    ]);
  });
});
