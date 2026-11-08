import { describe, it, expect } from "vitest";
import { mergePassthroughModels } from "@/shared/utils/modelPickerModels.js";

const zedLive = [
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { id: "gpt-6-sol", name: "GPT-6 Sol" },
];

describe("mergePassthroughModels (#4244)", () => {
  it("includes live catalog entries for a passthrough provider", () => {
    const merged = mergePassthroughModels({ live: zedLive, alias: "zd" });
    expect(merged.map((m) => m.value)).toEqual([
      "zd/claude-sonnet-5-5",
      "zd/gpt-6-sol",
    ]);
    expect(merged[0]).toMatchObject({
      id: "claude-sonnet-5-5",
      name: "Claude Sonnet 5.5",
      kind: "llm",
    });
  });

  it("keeps user-defined models ahead of the live catalog and dedupes by value", () => {
    const merged = mergePassthroughModels({
      aliases: [
        { id: "claude-sonnet-5-5", name: "My Sonnet", value: "zd/claude-sonnet-5-5" },
      ],
      live: zedLive,
      alias: "zd",
    });
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      name: "My Sonnet",
      value: "zd/claude-sonnet-5-5",
    });
    expect(merged[1].value).toBe("zd/gpt-6-sol");
  });

  it("falls back to the live model id when no display name is provided", () => {
    const merged = mergePassthroughModels({
      live: [{ id: "gpt-6-sol" }],
      alias: "zd",
    });
    expect(merged[0]).toMatchObject({
      name: "gpt-6-sol",
      value: "zd/gpt-6-sol",
    });
  });

  it("returns the static fallback when the live catalog is empty", () => {
    const merged = mergePassthroughModels({
      live: [],
      hardcoded: [{ id: "static-model", name: "Static", value: "zd/static-model" }],
      alias: "zd",
    });
    expect(merged.map((m) => m.value)).toEqual(["zd/static-model"]);
  });

  it("does not emit duplicate React keys", () => {
    const merged = mergePassthroughModels({
      live: [{ id: "same", name: "Live" }],
      aliases: [{ id: "same", name: "Alias", value: "zd/same" }],
      hardcoded: [{ id: "same", name: "Hardcoded", value: "zd/same" }],
      alias: "zd",
    });
    const values = merged.map((m) => m.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
