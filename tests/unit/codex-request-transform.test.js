import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

function makeBody(overrides = {}) {
  return {
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    ...overrides,
  };
}

describe("CodexExecutor request transform", () => {
  it("defaults base Codex models to medium effort", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest("gpt-5.3-codex", makeBody({ model: "gpt-5.3-codex" }), true, {});

    expect(out.model).toBe("gpt-5.3-codex");
    expect(out.reasoning).toEqual({ effort: "medium", summary: "auto" });
    expect(out.include).toEqual(["reasoning.encrypted_content"]);
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("uses model effort suffix and strips suffix before upstream call", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest("gpt-5.3-codex-high", makeBody({ model: "gpt-5.3-codex-high" }), true, {});

    expect(out.model).toBe("gpt-5.3-codex");
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("keeps explicit reasoning.effort over model suffix", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest(
      "gpt-5.3-codex-high",
      makeBody({ model: "gpt-5.3-codex-high", reasoning: { effort: "low" } }),
      true,
      {},
    );

    expect(out.model).toBe("gpt-5.3-codex");
    expect(out.reasoning).toEqual({ effort: "low", summary: "auto" });
  });

  it("applies reasoning_effort when reasoning object lacks effort", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest(
      "gpt-5.3-codex",
      makeBody({ model: "gpt-5.3-codex", reasoning: { summary: "detailed" }, reasoning_effort: "xhigh" }),
      true,
      {},
    );

    expect(out.reasoning).toEqual({ effort: "xhigh", summary: "detailed" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("preserves Chat Completions reasoning_effort through OpenAI Responses translation", () => {
    const translated = openaiToOpenAIResponsesRequest(
      "gpt-5.3-codex",
      {
        model: "gpt-5.3-codex",
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high",
      },
      true,
      null,
    );

    const executor = new CodexExecutor();
    const out = executor.transformRequest("gpt-5.3-codex", translated, true, {});

    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("does not request encrypted reasoning content when effort is none", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest("gpt-5.3-codex-none", makeBody({ model: "gpt-5.3-codex-none" }), true, {});

    expect(out.model).toBe("gpt-5.3-codex");
    expect(out.reasoning).toEqual({ effort: "none", summary: "auto" });
    expect(out.include).toBeUndefined();
  });

  it("removes encrypted reasoning include when effort is none", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest(
      "gpt-5.3-codex",
      makeBody({
        model: "gpt-5.3-codex",
        reasoning_effort: "none",
        include: ["reasoning.encrypted_content"],
      }),
      true,
      {},
    );

    expect(out.reasoning).toEqual({ effort: "none", summary: "auto" });
    expect(out.include).toBeUndefined();
  });

  it("preserves existing include values when adding encrypted reasoning content", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest(
      "gpt-5.3-codex",
      makeBody({
        model: "gpt-5.3-codex",
        include: ["web_search_call.action.sources"],
      }),
      true,
      {},
    );

    expect(out.include).toEqual(["web_search_call.action.sources", "reasoning.encrypted_content"]);
  });

  it("maps review aliases before effort suffix parsing", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest(
      "gpt-5.3-codex-high-review",
      makeBody({ model: "gpt-5.3-codex-high-review" }),
      true,
      {},
    );

    expect(out.model).toBe("gpt-5.3-codex");
    expect(out.reasoning).toEqual({ effort: "high", summary: "auto" });
  });

  it("strips parameters Codex backend rejects", () => {
    const executor = new CodexExecutor();
    const out = executor.transformRequest(
      "gpt-5.3-codex",
      makeBody({
        model: "gpt-5.3-codex",
        max_tokens: 100,
        max_completion_tokens: 100,
        max_output_tokens: 100,
        temperature: 0.2,
        stream_options: { include_usage: true },
        previous_response_id: "resp_abc",
      }),
      true,
      {},
    );

    expect(out.max_tokens).toBeUndefined();
    expect(out.max_completion_tokens).toBeUndefined();
    expect(out.max_output_tokens).toBeUndefined();
    expect(out.temperature).toBeUndefined();
    expect(out.stream_options).toBeUndefined();
    expect(out.previous_response_id).toBeUndefined();
  });

  describe("sanitizeCodexInput — fixes malformed input items", () => {
    it("adds type:message to items with role but no type", () => {
      const executor = new CodexExecutor();
      const body = {
        model: "gpt-5.3-codex",
        input: [{ role: "system", content: "you are helpful" }],
      };
      const out = executor.transformRequest("gpt-5.3-codex", body, true, {});

      expect(out.input[0].type).toBe("message");
      expect(out.input[0].role).toBe("developer");
    });

    it("converts bare-string content to typed array for message items", () => {
      const executor = new CodexExecutor();
      const body = {
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "user", content: "hello" }],
      };
      const out = executor.transformRequest("gpt-5.3-codex", body, true, {});

      expect(out.input[0].content).toEqual([{ type: "input_text", text: "hello" }]);
    });

    it("converts bare-string content to output_text for assistant messages", () => {
      const executor = new CodexExecutor();
      const body = {
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "assistant", content: "hi there" }],
      };
      const out = executor.transformRequest("gpt-5.3-codex", body, true, {});

      expect(out.input[0].content).toEqual([{ type: "output_text", text: "hi there" }]);
    });

    it("simulates caveman injection producing malformed input[0] and verifies fix", () => {
      const executor = new CodexExecutor();
      // Simulate what injectMessagesSystem USED TO produce: no type, string content
      const body = {
        model: "gpt-5.3-codex",
        input: [
          { role: "system", content: "Respond terse." },
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        ],
      };
      const out = executor.transformRequest("gpt-5.3-codex", body, true, {});

      expect(out.input[0].type).toBe("message");
      expect(out.input[0].role).toBe("developer");
      expect(out.input[0].content).toEqual([{ type: "input_text", text: "Respond terse." }]);
    });

    it("leaves well-formed message items unchanged", () => {
      const executor = new CodexExecutor();
      const body = {
        model: "gpt-5.3-codex",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        ],
      };
      const out = executor.transformRequest("gpt-5.3-codex", body, true, {});

      expect(out.input[0]).toEqual({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      });
    });

    it("does not add type to non-message items (reasoning, function_call)", () => {
      const executor = new CodexExecutor();
      const body = {
        model: "gpt-5.3-codex",
        input: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "thinking..." }] },
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        ],
      };
      const out = executor.transformRequest("gpt-5.3-codex", body, true, {});

      expect(out.input[0].type).toBe("reasoning");
      expect(out.input[0].summary).toBeDefined();
      expect(out.input[0].content).toBeUndefined();
    });
  });
});
