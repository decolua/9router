// Guards C2: regex name fallback (no catalog). Terse entries derive name; existing names untouched.
import { describe, it, expect } from "vitest";
import { deriveModelName } from "../../open-sse/providers/models/namePatterns.js";
import { normalizeModel, normalizeModelId } from "../../open-sse/providers/models/schema.js";

describe("model name regex fallback (C2)", () => {
  it("derives display name from id per family", () => {
    expect(deriveModelName("kimi-k2.5")).toBe("Kimi K2.5");
    expect(deriveModelName("glm-4.6v")).toBe("GLM 4.6V (Vision)");
    expect(deriveModelName("minimax-m2.7")).toBe("MiniMax M2.7");
    expect(deriveModelName("gpt-5.4-mini")).toBe("GPT 5.4 Mini");
    expect(deriveModelName("grok-4")).toBe("Grok 4");
  });

  it("falls back to id verbatim when no pattern matches", () => {
    expect(deriveModelName("some-unknown-model")).toBe("some-unknown-model");
  });

  it("normalizeModel: explicit name always wins over regex", () => {
    expect(normalizeModel({ id: "kimi-k2.5", name: "Custom" }).name).toBe("Custom");
  });

  it("normalizeModel: terse string id becomes object with derived name", () => {
    const m = normalizeModel("glm-5");
    expect(m.id).toBe("glm-5");
    expect(m.name).toBe("GLM 5");
  });

  it("normalizeModelId: dash between digits becomes a dot (version separator)", () => {
    expect(normalizeModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
    expect(normalizeModelId("minimax-m2-5")).toBe("minimax-m2.5");
    expect(normalizeModelId("deepseek-3-2")).toBe("deepseek-3.2");
  });

  it("normalizeModelId: preserves word-suffix hyphens (-thinking, -agentic)", () => {
    expect(normalizeModelId("claude-sonnet-4-5-thinking")).toBe("claude-sonnet-4.5-thinking");
    expect(normalizeModelId("claude-sonnet-4-5-thinking-agentic")).toBe("claude-sonnet-4.5-thinking-agentic");
  });

  it("normalizeModelId: leaves ids with no digit-digit hyphen untouched", () => {
    expect(normalizeModelId("qwen3-coder-next")).toBe("qwen3-coder-next");
    expect(normalizeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(normalizeModelId("glm-5")).toBe("glm-5");
  });

  it("normalizeModelId: non-string input passes through", () => {
    expect(normalizeModelId(undefined)).toBeUndefined();
    expect(normalizeModelId(null)).toBeNull();
  });
});
