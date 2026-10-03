import { describe, expect, it } from "vitest";

const { buildInfo, GET } = await import("../../src/app/api/v1/models/info/route.js");

describe("models info runtime capabilities", () => {
  it("publishes runtime LLM capabilities and context", () => {
    expect(buildInfo({
      alias: "cc",
      providerId: "claude",
      kind: "llm",
      model: { id: "claude-opus-5", name: "Claude Opus 5" },
    })).toMatchObject({
      contextWindow: 1_000_000,
      capabilities: {
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        thinkingFormat: "claude-adaptive",
      },
    });
  });

  it("merges object overrides without dropping runtime fields", () => {
    expect(buildInfo({
      alias: "cc",
      providerId: "claude",
      kind: "llm",
      model: {
        id: "claude-opus-5",
        capabilities: { maxOutput: 64_000, customFlag: true },
      },
    })).toMatchObject({
      capabilities: {
        contextWindow: 1_000_000,
        maxOutput: 64_000,
        thinkingFormat: "claude-adaptive",
        customFlag: true,
      },
    });
  });

  it("preserves legacy capability arrays while deriving context", () => {
    expect(buildInfo({
      alias: "cc",
      providerId: "claude",
      kind: "llm",
      model: { id: "claude-opus-5", capabilities: ["legacy-cap"] },
    })).toMatchObject({
      contextWindow: 1_000_000,
      capabilities: ["legacy-cap"],
    });
  });

  it("keeps explicit LLM context ahead of runtime context", () => {
    expect(buildInfo({
      alias: "cc",
      providerId: "claude",
      kind: "llm",
      model: { id: "claude-opus-5", contextWindow: 200_000 },
    }).contextWindow).toBe(200_000);
  });

  it("leaves non-LLM metadata unchanged", () => {
    expect(buildInfo({
      alias: "xai",
      providerId: "xai",
      kind: "image",
      model: { id: "grok-imagine-image", capabilities: ["image"], contextWindow: 42 },
    })).toMatchObject({
      capabilities: ["image"],
      contextWindow: 42,
    });
  });

  it("serves runtime metadata through GET", async () => {
    const response = await GET(new Request("http://localhost/v1/models/info?id=cc/claude-opus-5"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "cc/claude-opus-5",
      contextWindow: 1_000_000,
      capabilities: { maxOutput: 128_000 },
    });
  });
});
