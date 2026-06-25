import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("claudeToOpenAIRequest", () => {
  it("converts Claude Code SDK payloads to clean OpenAI chat payloads", () => {
    const result = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "kimi-k2.6",
      {
        model: "kimi/kimi-k2.6",
        system: [{ type: "text", text: "system one", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }] }],
        tools: [{ name: "Read", description: "read files", input_schema: { type: "object", properties: {} } }],
        thinking: { type: "adaptive" },
        context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
        output_config: { effort: "high" },
        max_tokens: 32000,
      },
      true,
    );

    expect(result.model).toBe("kimi-k2.6");
    expect(result.system).toBeUndefined();
    expect(result.thinking).toBeUndefined();
    expect(result.context_management).toBeUndefined();
    expect(result.output_config).toBeUndefined();
    expect(result.messages[0]).toEqual({ role: "system", content: "system one" });
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" });
    expect(result.tools[0]).toMatchObject({ type: "function", function: { name: "Read" } });
  });
});
