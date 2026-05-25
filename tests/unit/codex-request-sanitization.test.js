import { describe, it, expect } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { CODEX_DEFAULT_INSTRUCTIONS } from "../../open-sse/config/codexInstructions.js";

describe("CodexExecutor request sanitization", () => {
  it("strips n8n Responses API defaults unsupported by Codex", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.3-codex",
      input: "hello",
      background: false,
      parallel_tool_calls: true,
      store: true,
      truncation: "auto",
      max_output_tokens: 1000,
      max_completion_tokens: 1000,
    };

    const transformed = executor.transformRequest("gpt-5.3-codex", body, true, {});

    expect(transformed).not.toHaveProperty("background");
    expect(transformed).not.toHaveProperty("parallel_tool_calls");
    expect(transformed).not.toHaveProperty("truncation");
    expect(transformed).not.toHaveProperty("max_output_tokens");
    expect(transformed).not.toHaveProperty("max_completion_tokens");
    expect(transformed.store).toBe(false);
  });

  it("moves system/developer input messages into instructions", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.3-codex",
      instructions: "Existing instruction",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "Return JSON only." }],
        },
        {
          role: "developer",
          content: "Be concise.",
        },
        {
          role: "user",
          content: [{ type: "input_text", text: "Hello" }],
        },
      ],
    };

    const transformed = executor.transformRequest("gpt-5.3-codex", body, true, {});

    expect(transformed.instructions).toBe("Existing instruction\n\nReturn JSON only.\n\nBe concise.");
    expect(transformed.input).toHaveLength(1);
    expect(transformed.input[0].role).toBe("user");
  });

  it("uses default instructions when system-only input is removed", () => {
    const executor = new CodexExecutor();
    const body = {
      model: "gpt-5.3-codex",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "Return JSON only." }],
        },
      ],
    };

    const transformed = executor.transformRequest("gpt-5.3-codex", body, true, {});

    expect(transformed.instructions).toContain("Return JSON only.");
    expect(transformed.instructions).not.toBe(CODEX_DEFAULT_INSTRUCTIONS);
    expect(transformed.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "..." }] },
    ]);
  });
});
