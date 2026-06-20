import { describe, it, expect } from "vitest";
import { generateRequestToken, mapModel } from "../../open-sse/executors/theoldllm.js";

describe("theoldllm executor", () => {
  it("generateRequestToken produces the ts-djb2-hex format", () => {
    const tok = generateRequestToken();
    // `${n.toString(36)}-${Math.abs(t).toString(36)}-${8 hex chars}`
    expect(tok).toMatch(/^[0-9a-z]+-[0-9a-z]+-[0-9a-f]{8}$/);
    const parts = tok.split("-");
    expect(parts.length).toBe(3);
    // two unique tokens differ (timestamp + uuid move forward)
    expect(generateRequestToken()).not.toBe(tok);
  });

  it("mapModel resolves GPT aliases", () => {
    expect(mapModel("gpt-5.4")).toBe("GPT_5_4");
    expect(mapModel("gpt_5_3")).toBe("GPT_5_3");
    expect(mapModel("gpt-4o")).toBe("GPT_4O");
  });

  it("mapModel resolves Claude aliases and families", () => {
    expect(mapModel("claude-4.6-opus")).toBe("CLAUDE_4_6_OPUS");
    expect(mapModel("claude-4.6-sonnet")).toBe("CLAUDE_4_6_SONNET");
    expect(mapModel("claude opus 4")).toBe("CLAUDE_4_6_OPUS");
    // family fallback for unmapped claude
    expect(mapModel("claude-something-haiku")).toBe("CLAUDE_4_5_HAIKU");
  });

  it("mapModel defaults unknown models to GPT_5_4", () => {
    expect(mapModel("unknown-model")).toBe("GPT_5_4");
    expect(mapModel("")).toBe("GPT_5_4");
  });
});
