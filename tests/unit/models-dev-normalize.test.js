import { describe, expect, it } from "vitest";
import { normalizeModel } from "@/lib/modelsDev/index.js";

describe("models.dev normalizeModel", () => {
  it("maps a full entry to caps + pricing", () => {
    const normalized = normalizeModel({
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      family: "claude-sonnet",
      release_date: "2025-09-29",
      last_updated: "2025-10-01",
      modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      reasoning: true,
      tool_call: true,
      limit: { context: 200000, output: 64000 },
      cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
    });

    expect(normalized).toEqual({
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
      family: "claude-sonnet",
      releaseDate: "2025-09-29",
      lastUpdated: "2025-10-01",
      caps: {
        vision: true,
        pdf: true,
        audioInput: false,
        videoInput: false,
        imageOutput: false,
        audioOutput: false,
        reasoning: true,
        tools: true,
        contextWindow: 200000,
        maxOutput: 64000,
      },
      pricing: { input: 3, output: 15, cached: 0.3, cache_creation: 3.75 },
    });
  });

  it("maps output modalities to imageOutput/audioOutput", () => {
    const normalized = normalizeModel({
      id: "image-gen",
      modalities: { input: ["text"], output: ["text", "image", "audio"] },
    });
    expect(normalized.caps.imageOutput).toBe(true);
    expect(normalized.caps.audioOutput).toBe(true);
    expect(normalized.caps.vision).toBe(false);
  });

  it("only sets tools when tool_call is explicitly present", () => {
    expect(normalizeModel({ id: "a" }).caps).not.toHaveProperty("tools");
    expect(normalizeModel({ id: "b", tool_call: false }).caps.tools).toBe(false);
    expect(normalizeModel({ id: "c", tool_call: true }).caps.tools).toBe(true);
  });

  it("omits contextWindow/maxOutput when limits are missing", () => {
    const normalized = normalizeModel({ id: "a" });
    expect(normalized.caps).not.toHaveProperty("contextWindow");
    expect(normalized.caps).not.toHaveProperty("maxOutput");
  });

  it("returns null pricing when cost is missing or empty", () => {
    expect(normalizeModel({ id: "a" }).pricing).toBeNull();
    expect(normalizeModel({ id: "a", cost: {} }).pricing).toBeNull();
  });

  it("keeps partial cost fields only", () => {
    const normalized = normalizeModel({ id: "a", cost: { input: 1.25 } });
    expect(normalized.pricing).toEqual({ input: 1.25 });
  });

  it("returns null for invalid entries", () => {
    expect(normalizeModel(null)).toBeNull();
    expect(normalizeModel({})).toBeNull();
    expect(normalizeModel("model")).toBeNull();
  });

  it("falls back to id for missing optional strings", () => {
    const normalized = normalizeModel({ id: "a" });
    expect(normalized.name).toBe("a");
    expect(normalized.family).toBeNull();
    expect(normalized.releaseDate).toBeNull();
    expect(normalized.lastUpdated).toBeNull();
  });
});
