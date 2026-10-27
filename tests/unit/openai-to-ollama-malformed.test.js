// A4 (case #10): malformed tool_calls args must not throw -> safeParseJSON returns {}.
import { describe, it, expect } from "vitest";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";
import { ollamaBodyToOpenAI, ollamaToOpenAIResponse } from "../../open-sse/translator/response/ollama-to-openai.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripIncompatibleReasoningContent } from "../../open-sse/translator/concerns/reasoning.js";

function reqWith(args) {
  return {
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: args } }],
      },
    ],
  };
}

describe("openaiToOllamaRequest - tool_calls arguments parsing", () => {
  it("malformed JSON args -> {} (no throw)", () => {
    let out;
    expect(() => {
      out = openaiToOllamaRequest("m", reqWith("{invalid json"), true);
    }).not.toThrow();
    expect(out.messages[0].tool_calls[0].function.arguments).toEqual({});
  });

  it("valid JSON args -> parsed object", () => {
    const out = openaiToOllamaRequest("m", reqWith('{"a":1}'), true);
    expect(out.messages[0].tool_calls[0].function.arguments).toEqual({ a: 1 });
  });
});

describe("Ollama native thinking", () => {
  it("preserves an explicit think field", () => {
    expect(openaiToOllamaRequest("gemma4:cloud", {
      messages: [],
      extra_body: { think: true },
    }, false).think).toBe(true);
  });

  it("maps OpenAI effort to Ollama think level for Gemma 4", () => {
    const body = { reasoning_effort: "high" };
    applyThinking("ollama", "gemma4:cloud", body, "ollama");
    expect(body.think).toBe("high");
    expect(getCapabilitiesForModel("ollama", "gemma4:cloud")).toMatchObject({
      reasoning: true,
      thinkingFormat: "ollama",
    });
  });

  it("maps Ollama thinking in non-streaming and streaming responses", () => {
    const body = ollamaBodyToOpenAI({
      model: "gemma4:cloud",
      message: { role: "assistant", thinking: "private thought", content: "answer" },
      done: true,
    });
    expect(body.choices[0].message.reasoning_content).toBe("private thought");

    const state = {};
    const chunk = ollamaToOpenAIResponse({
      model: "gemma4:cloud",
      message: { role: "assistant", thinking: "private thought", content: "answer" },
      done: false,
    }, state);
    expect(chunk.choices[0].delta.reasoning_content).toBe("private thought");
  });

  it("keeps Ollama reasoning_content in the final non-streaming response", () => {
    const response = {
      choices: [{ message: { content: "answer", reasoning_content: "private thought" } }],
    };
    stripIncompatibleReasoningContent(response, "ollama");
    expect(response.choices[0].message.reasoning_content).toBe("private thought");
  });
});
