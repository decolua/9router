// A4 (case #10): malformed tool_calls args must not throw -> safeParseJSON returns {}.
import { describe, it, expect } from "vitest";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";
import { ollamaBodyToOpenAI, ollamaToOpenAIResponse } from "../../open-sse/translator/response/ollama-to-openai.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripIncompatibleReasoningContent } from "../../open-sse/translator/concerns/reasoning.js";
import { stripUnsupportedModalities } from "../../open-sse/translator/concerns/modality.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

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

  it.each(["minimal", "low", "medium", "high", "xhigh", "max", "auto"])(
    "maps reasoning_effort=%s to boolean think for Gemma 4",
    (effort) => {
      const body = { reasoning_effort: effort };
      applyThinking("ollama", "gemma4:cloud", body, "ollama");
      expect(body.think).toBe(true);
      expect(getCapabilitiesForModel("ollama", "gemma4:cloud")).toMatchObject({
        vision: true,
        reasoning: true,
        thinkingFormat: "ollama",
      });
    }
  );

  it.each([
    { thinking: { type: "enabled", budget_tokens: 4096 } },
    { reasoning: { effort: "high" } },
    { think: true },
    { extra_body: { think: true } },
  ])("maps %j to boolean think for Gemma 4", (intent) => {
    const body = { ...intent };
    applyThinking("ollama", "gemma4:cloud", body, "ollama");
    expect(body.think).toBe(true);
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.extra_body?.think).toBeUndefined();
  });

  it("only explicit disable sends think=false", () => {
    const body = { thinking: { type: "disabled" } };
    applyThinking("ollama", "gemma4:cloud", body, "ollama");
    expect(body.think).toBe(false);
  });

  it("leaves think untouched when the client sends no thinking intent", () => {
    const body = { messages: [] };
    applyThinking("ollama", "gemma4:cloud", body, "ollama");
    expect(body.think).toBeUndefined();
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

describe("Ollama Gemma 4 vision capability and modality forwarding", () => {
  it("resolves vision: true, reasoning: true for gemma4:cloud and gemma4 patterns", () => {
    const cloudCaps = getCapabilitiesForModel("ollama", "gemma4:cloud");
    expect(cloudCaps.vision).toBe(true);
    expect(cloudCaps.reasoning).toBe(true);
    expect(cloudCaps.thinkingFormat).toBe("ollama");

    const patternCaps1 = getCapabilitiesForModel(null, "gemma4:31b");
    expect(patternCaps1.vision).toBe(true);
    expect(patternCaps1.reasoning).toBe(true);
    expect(patternCaps1.thinkingFormat).toBe("ollama");

    const patternCaps2 = getCapabilitiesForModel(null, "gemma-4-it");
    expect(patternCaps2.vision).toBe(true);
    expect(patternCaps2.reasoning).toBe(true);
    expect(patternCaps2.thinkingFormat).toBe("ollama");
  });

  it("does not strip images for gemma4:cloud and preserves images array in openaiToOllamaRequest", () => {
    const caps = getCapabilitiesForModel("ollama", "gemma4:cloud");
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const body = {
      model: "gemma4:cloud",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is in this image?" },
            { type: "image_url", image_url: { url: `data:image/png;base64,${fakeBase64}` } },
          ],
        },
      ],
    };

    stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
    expect(JSON.stringify(body)).not.toContain("[image omitted");
    expect(body.messages[0].content.some((b) => b.type === "image_url")).toBe(true);

    const ollamaReq = openaiToOllamaRequest("gemma4:cloud", body, false);
    expect(ollamaReq.messages[0].content).toBe("what is in this image?");
    expect(ollamaReq.messages[0].images).toEqual([fakeBase64]);
  });
});

