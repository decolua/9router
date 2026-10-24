import { describe, expect, it } from "vitest";
import {
  normalizeKiroUpstreamModelId,
  resolveKiroModel,
} from "../../open-sse/config/kiroConstants.js";

// Kiro's GenerateAssistantResponse only accepts the dotted upstream alias
// (`claude-sonnet-4.5`). Anything else — including the date-suffixed snapshot
// ids Claude Code and cc-switch send — comes back as
// `400 {"message":"Invalid model ID...","reason":"INVALID_MODEL_ID"}`.
describe("normalizeKiroUpstreamModelId", () => {
  it("strips the Anthropic date snapshot suffix", () => {
    expect(normalizeKiroUpstreamModelId("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4.5");
    expect(normalizeKiroUpstreamModelId("claude-opus-4-5-20251101")).toBe("claude-opus-4.5");
    expect(normalizeKiroUpstreamModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4.5");
    expect(normalizeKiroUpstreamModelId("claude-3-5-sonnet-20241022")).toBe("claude-sonnet-4.5");
  });

  it("maps dash-separated Anthropic ids onto dotted Kiro ids", () => {
    expect(normalizeKiroUpstreamModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
    expect(normalizeKiroUpstreamModelId("claude-opus-4-5")).toBe("claude-opus-4.5");
    expect(normalizeKiroUpstreamModelId("claude-opus-4-8")).toBe("claude-opus-4.8");
  });

  it("keeps ids that already match the upstream alias", () => {
    for (const id of [
      "claude-opus-5.5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      "auto",
      "deepseek-3.2",
      "glm-5",
      "qwen3-coder-next",
      "kimi-k3",
      "minimax-m2.5",
      "minimax-m2.1",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]) {
      expect(normalizeKiroUpstreamModelId(id)).toBe(id);
    }
  });

  it("fixes the MiniMax casing the static catalog ships", () => {
    // PROVIDER_MODELS.kr advertises `MiniMax-M2.5`; upstream only accepts the
    // lowercase `minimax-m2.5` and 400s on the capitalized form.
    expect(normalizeKiroUpstreamModelId("MiniMax-M2.5")).toBe("minimax-m2.5");
  });

  it("routes unknown ids through untouched", () => {
    expect(normalizeKiroUpstreamModelId("some-future-model")).toBe("some-future-model");
    expect(normalizeKiroUpstreamModelId("")).toBe("");
    expect(normalizeKiroUpstreamModelId(undefined)).toBe(undefined);
  });
});

describe("resolveKiroModel upstream normalization", () => {
  it("normalizes after stripping the synthetic suffixes", () => {
    expect(resolveKiroModel("claude-sonnet-4-5-20250929-thinking-agentic")).toEqual({
      upstream: "claude-sonnet-4.5",
      agentic: true,
      thinking: true,
    });
  });

  it("still reports the suffix flags it consumed", () => {
    expect(resolveKiroModel("claude-opus-4-5-20251101-thinking")).toEqual({
      upstream: "claude-opus-4.5",
      agentic: false,
      thinking: true,
    });
  });

  it("leaves an already-canonical id alone", () => {
    expect(resolveKiroModel("claude-opus-5.5")).toEqual({
      upstream: "claude-opus-5.5",
      agentic: false,
      thinking: false,
    });
  });
});
