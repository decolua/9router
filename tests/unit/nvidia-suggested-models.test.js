import { describe, it, expect } from "vitest";
import { FILTERS } from "../../src/app/api/providers/suggested-models/filters.js";

// NVIDIA NIM's /v1/models mixes chat models with embedding, guard, safety and
// detection endpoints. Only the chat ones are routable through
// /v1/chat/completions, so the dashboard suggestions must skip the rest.
const CATALOG = [
  { id: "moonshotai/kimi-k3.1-pro", context_window: 1048576 },
  { id: "stepfun-ai/step-5-preview" },
  { id: "nvidia/nemotron-3.5-lightning-30b-a3b" },
  { id: "nvidia/nv-embedqa-e5-v5" },
  { id: "nvidia/nemotron-3-embed-1b" },
  { id: "nvidia/nvclip" },
  { id: "meta/llama-guard-4-12b" },
  { id: "nvidia/nemotron-3.5-content-safety" },
  { id: "nvidia/ai-synthetic-video-detector" },
  { id: "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1" },
  { id: "nvidia/riva-translate-4b-instruct-v2" },
  { id: "nvidia/parakeet-ctc-1.1b-asr" },
];

describe("NVIDIA suggested-models filter", () => {
  it("keeps the chat models and drops the non-chat endpoints", () => {
    const ids = FILTERS.nvidia(CATALOG).map((m) => m.id);

    expect(ids).toContain("moonshotai/kimi-k3.1-pro");
    expect(ids).toContain("stepfun-ai/step-5-preview");
    expect(ids).toContain("nvidia/nemotron-3.5-lightning-30b-a3b");

    expect(ids).not.toContain("nvidia/nv-embedqa-e5-v5");
    expect(ids).not.toContain("nvidia/nemotron-3-embed-1b");
    expect(ids).not.toContain("nvidia/nvclip");
    expect(ids).not.toContain("meta/llama-guard-4-12b");
    expect(ids).not.toContain("nvidia/nemotron-3.5-content-safety");
    expect(ids).not.toContain("nvidia/ai-synthetic-video-detector");
    expect(ids).not.toContain("nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1");
    expect(ids).not.toContain("nvidia/riva-translate-4b-instruct-v2");
    expect(ids).not.toContain("nvidia/parakeet-ctc-1.1b-asr");
  });

  it("labels a model with its bare id and carries the context window", () => {
    const kimi = FILTERS.nvidia(CATALOG).find((m) => m.id === "moonshotai/kimi-k3.1-pro");

    expect(kimi.name).toBe("kimi-k3.1-pro");
    expect(kimi.contextLength).toBe(1048576);
  });

  it("returns an empty list for a malformed catalogue", () => {
    expect(FILTERS.nvidia(undefined)).toEqual([]);
    expect(FILTERS.nvidia([{ id: 42 }])).toEqual([]);
  });
});
