import { describe, it, expect } from "vitest";
import { ollamaBodyToOpenAI } from "../../open-sse/translator/response/ollama-to-openai.js";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

describe("ollamaBodyToOpenAI - unparseable body handling", () => {
  it("case (a): native Ollama body with message, done, usage -> yields content and real usage", () => {
    const body = {
      model: "qwen2.5-coder-7b:latest",
      message: { role: "assistant", content: "PONG" },
      done: true,
      prompt_eval_count: 34,
      eval_count: 3,
    };
    const result = ollamaBodyToOpenAI(body);
    expect(result.choices[0].message.content).toBe("PONG");
    expect(result.usage.prompt_tokens).toBe(34);
    expect(result.usage.completion_tokens).toBe(3);
  });

  it("case (b): body with neither message nor done (e.g. OpenAI-shaped) -> must throw/signal error, not return empty success", () => {
    const body = {
      choices: [{ message: { role: "assistant", content: "PONG" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    expect(() => ollamaBodyToOpenAI(body)).toThrow();
  });

  it("case (c): body with error field -> must propagate as error", () => {
    const body = {
      error: { message: "model not found", type: "server_error" },
    };
    expect(() => ollamaBodyToOpenAI(body)).toThrow();
  });

  it("case (d): valid body but missing prompt_eval_count/eval_count -> should not fabricate usage", () => {
    const body = {
      model: "test-model",
      message: { role: "assistant", content: "PONG" },
      done: true,
    };
    const result = ollamaBodyToOpenAI(body);
    expect(result.choices[0].message.content).toBe("PONG");
    // Usage must be absent, not fabricated (a null would crash consumers)
    expect(result.usage).toBeUndefined();
  });
});

describe("toOpenAIUsage - ollama extractor", () => {
  it("returns null when raw is not an ollama done chunk", () => {
    const result = toOpenAIUsage({ choices: [] }, "ollama");
    expect(result).toBeNull();
  });

  it("returns null when prompt_eval_count and eval_count are both missing", () => {
    const result = toOpenAIUsage({ done: true, model: "test" }, "ollama");
    expect(result).toBeNull();
  });

  it("extracts usage when prompt_eval_count and eval_count present", () => {
    const result = toOpenAIUsage({ done: true, prompt_eval_count: 34, eval_count: 3 }, "ollama");
    expect(result.prompt_tokens).toBe(34);
    expect(result.completion_tokens).toBe(3);
  });
});