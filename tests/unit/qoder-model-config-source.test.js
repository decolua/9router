// Qoder routes the chat by `model_config.source`: the catalog's `source:"system"`
// sends the request into the managed lane, which answers `10605/queueType=p3`
// while that lane is busy, whereas the same payload with the field omitted is
// served immediately. The executor must therefore echo the catalog entry minus
// `source`, while the X-Model-Source header keeps reporting the catalog value.
import { describe, expect, it } from "vitest";
import { qoderChatModelConfig } from "../../open-sse/shared/qoder/constants.js";

const CATALOG_ENTRY = {
  key: "dfmodel",
  display_name: "DeepSeek-V4-Flash",
  source: "system",
  is_vl: false,
  is_reasoning: false,
  max_input_tokens: 180000,
  context_config: ["200K", "400K", "1M"],
};

describe("qoderChatModelConfig (queue lane)", () => {
  it("drops `source` so the request leaves the managed lane", () => {
    const out = qoderChatModelConfig(CATALOG_ENTRY);
    expect(out.source).toBeUndefined();
    expect("source" in out).toBe(false);
  });

  it("keeps every other catalog field untouched", () => {
    const out = qoderChatModelConfig(CATALOG_ENTRY);
    expect(out).toEqual({
      key: "dfmodel",
      display_name: "DeepSeek-V4-Flash",
      is_vl: false,
      is_reasoning: false,
      max_input_tokens: 180000,
      context_config: ["200K", "400K", "1M"],
    });
  });

  it("does not mutate the caller's catalog entry", () => {
    qoderChatModelConfig(CATALOG_ENTRY);
    expect(CATALOG_ENTRY.source).toBe("system");
  });

  it("returns the input unchanged when there is no `source` to drop", () => {
    const noSource = { key: "dmodel", display_name: "DeepSeek-V4-Pro" };
    expect(qoderChatModelConfig(noSource)).toBe(noSource);
  });

  it("passes through a null/undefined config instead of throwing", () => {
    expect(qoderChatModelConfig(null)).toBeNull();
    expect(qoderChatModelConfig(undefined)).toBeUndefined();
  });
});
