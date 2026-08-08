import { describe, expect, it } from "vitest";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";
import { getProviderModelsFetcher } from "@/shared/constants/providers";

describe("HuggingFace suggested models", () => {
  it("exposes kind-specific fetchers for media providers", () => {
    const imageFetcher = getProviderModelsFetcher("huggingface", "image");
    const sttFetcher = getProviderModelsFetcher("huggingface", "stt");
    const imageUrl = new URL(imageFetcher.url);
    const sttUrl = new URL(sttFetcher.url);

    expect(imageFetcher.type).toBe("huggingface-hub");
    expect(imageUrl.origin + imageUrl.pathname).toBe("https://huggingface.co/api/models");
    expect(imageUrl.searchParams.get("inference_provider")).toBe("hf-inference");
    expect(imageUrl.searchParams.get("pipeline_tag")).toBe("text-to-image");
    expect(imageUrl.searchParams.get("limit")).toBe("30");

    expect(sttFetcher.type).toBe("huggingface-hub");
    expect(sttUrl.origin + sttUrl.pathname).toBe("https://huggingface.co/api/models");
    expect(sttUrl.searchParams.get("inference_provider")).toBe("hf-inference");
    expect(sttUrl.searchParams.get("pipeline_tag")).toBe("automatic-speech-recognition");
    expect(sttUrl.searchParams.get("limit")).toBe("30");
  });

  it("sorts HuggingFace Hub suggestions by popularity", () => {
    const models = FILTERS["huggingface-hub"]([
      { id: "org/model-c", downloads: 10, likes: 5 },
      { id: "org/model-a", downloads: 100, likes: 1 },
      { id: "org/model-b", downloads: 100, likes: 10 },
    ]);

    expect(models.map((model) => model.id)).toEqual([
      "org/model-b",
      "org/model-a",
      "org/model-c",
    ]);
  });
});
