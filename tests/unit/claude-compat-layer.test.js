// Tests for the Claude compat layer (src/lib/claudeCompat.js) — the
// cc-switch-replacement logic that rewrites /v1/models ids for Anthropic
// clients and normalizes claude-wrapped model names back on /v1/messages.
import { describe, it, expect } from "vitest";

import {
  looksLikeClaudeWrappedModel,
  normalizeClaudeModelName,
  readClaudeCompat,
  rewriteModelsListForClaude,
} from "@/lib/claudeCompat.js";

const INDEX = {
  pairs: new Set([
    "bai/deepseek-v4-flash",
    "glm/glm-4.7",
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-5",
    "myalias/my-model[1m]", // internal [1m] marker already present
  ]),
  bare: new Set(["my-combo", "fast-alias"]),
};

describe("looksLikeClaudeWrappedModel", () => {
  it("detects claude- prefix (any case)", () => {
    expect(looksLikeClaudeWrappedModel("claude-bai/deepseek-v4-flash")).toBe(true);
    expect(looksLikeClaudeWrappedModel("Claude-sonnet-4-5")).toBe(true);
  });

  it("detects [1m]/[1M] suffix", () => {
    expect(looksLikeClaudeWrappedModel("bai/deepseek-v4-flash[1m]")).toBe(true);
    expect(looksLikeClaudeWrappedModel("bai/deepseek-v4-flash[1M]")).toBe(true);
  });

  it("ignores plain names", () => {
    expect(looksLikeClaudeWrappedModel("deepseek-v4-flash")).toBe(false);
    expect(looksLikeClaudeWrappedModel("bai/deepseek-v4-flash")).toBe(false);
    expect(looksLikeClaudeWrappedModel("gpt-5")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(looksLikeClaudeWrappedModel(undefined)).toBe(false);
    expect(looksLikeClaudeWrappedModel(null)).toBe(false);
    expect(looksLikeClaudeWrappedModel(42)).toBe(false);
  });
});

describe("normalizeClaudeModelName", () => {
  it("strips prefix+suffix from derived route form", () => {
    expect(normalizeClaudeModelName("claude-bai/deepseek-v4-flash[1m]", INDEX)).toBe(
      "bai/deepseek-v4-flash"
    );
    // case-insensitive [1m]
    expect(normalizeClaudeModelName("claude-glm/glm-4.7[1M]", INDEX)).toBe("glm/glm-4.7");
  });

  it("keeps official claude models untouched", () => {
    expect(normalizeClaudeModelName("claude-sonnet-4-5", INDEX)).toBe("claude-sonnet-4-5");
    // Official model with the context suffix: [1m] must come off (the 1M
    // toggle travels via the anthropic-beta header, never in the model name),
    // but the base name stays.
    expect(normalizeClaudeModelName("claude-opus-4-1[1m]", INDEX)).toBe("claude-opus-4-1");
  });

  it("maps known bare names (combos, alias keys)", () => {
    expect(normalizeClaudeModelName("claude-my-combo", INDEX)).toBe("my-combo");
    expect(normalizeClaudeModelName("claude-fast-alias", INDEX)).toBe("fast-alias");
  });

  it("keeps unknown claude-* names (likely official Anthropic models)", () => {
    expect(normalizeClaudeModelName("claude-haiku-4-5-20251001", INDEX)).toBe(
      "claude-haiku-4-5-20251001"
    );
  });

  it("handles bare claude-prefixed pair form", () => {
    // "claude-anthropic/claude-3-x" — rest contains slash, strip prefix only
    expect(normalizeClaudeModelName("claude-anthropic/claude-3-x", INDEX)).toBe(
      "anthropic/claude-3-x"
    );
  });

  it("strips lone [1m] suffix without prefix", () => {
    expect(normalizeClaudeModelName("bai/deepseek-v4-flash[1m]", INDEX)).toBe(
      "bai/deepseek-v4-flash"
    );
  });

  it("returns non-claude names unchanged after suffix strip", () => {
    expect(normalizeClaudeModelName("openai/gpt-5", INDEX)).toBe("openai/gpt-5");
  });

  it("handles degenerate inputs", () => {
    expect(normalizeClaudeModelName("", INDEX)).toBe("");
    expect(normalizeClaudeModelName("claude-", INDEX)).toBe("claude-");
    expect(normalizeClaudeModelName(undefined, INDEX)).toBeUndefined();
  });
});

describe("readClaudeCompat", () => {
  it("defaults to enabled + auto mode", () => {
    expect(readClaudeCompat({})).toEqual({
      enabled: true,
      suffixMode: "auto",
      keywords: [],
    });
    expect(readClaudeCompat(undefined)).toEqual(readClaudeCompat({}));
  });

  it("honors explicit config and sanitizes garbage", () => {
    expect(
      readClaudeCompat({ claudeCompat: { enabled: false, suffixMode: "keywords", keywords: ["glm", "", 42] } })
    ).toEqual({ enabled: false, suffixMode: "keywords", keywords: ["glm"] });
    // invalid suffixMode falls back
    expect(readClaudeCompat({ claudeCompat: { suffixMode: "yolo" } }).suffixMode).toBe("auto");
  });
});

describe("rewriteModelsListForClaude", () => {
  const compat = { enabled: true, suffixMode: "auto", keywords: [] };

  it("prefixes ids, sets display_name, appends [1m] per policy", () => {
    const out = rewriteModelsListForClaude(
      [
        { id: "bai/deepseek-v4-flash", object: "model", owned_by: "bai" },
        { id: "glm/glm-4.7", object: "model", owned_by: "glm", context_length: 200_000 },
        { id: "x/big-window", object: "model", owned_by: "x", context_length: 1_048_576 },
      ],
      compat
    );
    expect(out[0].id).toBe("claude-bai/deepseek-v4-flash"); // no context_length -> no suffix in auto
    expect(out[0].display_name).toBe("bai/deepseek-v4-flash");
    expect(out[1].id).toBe("claude-glm/glm-4.7");
    expect(out[2].id).toBe("claude-x/big-window[1m]");
    expect(out[2].display_name).toBe("x/big-window");
  });

  it("does not double-suffix ids that already carry [1m]", () => {
    const out = rewriteModelsListForClaude(
      [{ id: "myalias/my-model[1m]", object: "model", owned_by: "myalias" }],
      compat
    );
    expect(out[0].id).toBe("claude-myalias/my-model[1m]");
    // display_name strips the internal marker for display
    expect(out[0].display_name).toBe("myalias/my-model");
  });

  it("keywords mode matches model part case-insensitively", () => {
    const kw = { enabled: true, suffixMode: "keywords", keywords: ["DeepSeek"] };
    const out = rewriteModelsListForClaude(
      [
        { id: "bai/deepseek-v4-flash", object: "model" },
        { id: "glm/glm-4.7", object: "model" },
      ],
      kw
    );
    expect(out[0].id.endsWith("[1m]")).toBe(true);
    expect(out[1].id.endsWith("[1m]")).toBe(false);
  });

  it("off mode never suffixes; combos get prefixed too", () => {
    const off = { enabled: true, suffixMode: "off", keywords: [] };
    const out = rewriteModelsListForClaude(
      [
        { id: "my-combo", object: "model", owned_by: "combo" },
        { id: "x/huge", object: "model", context_length: 2_000_000 },
      ],
      off
    );
    expect(out[0].id).toBe("claude-my-combo");
    expect(out[1].id).toBe("claude-x/huge");
  });

  it("passes through malformed entries", () => {
    const entry = { foo: 1 };
    expect(rewriteModelsListForClaude([entry], compat)[0]).toBe(entry);
  });
});
