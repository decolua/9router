import { describe, expect, it } from "vitest";
import "./registerAll.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

function gemmaToolBody() {
  return {
    messages: [
      { role: "user", content: "Look something up." },
      {
        role: "assistant",
        content: "I will check.",
        reasoning_content: "internal reasoning should not be replayed to Gemma 4",
        tool_calls: [
          {
            id: "call_search",
            type: "function",
            function: { name: "search_files", arguments: '{"pattern":"x"}' }
          }
        ]
      },
      { role: "tool", tool_call_id: "call_search", content: '{"result":"ok"}' },
      { role: "user", content: "Summarize briefly." }
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "search_files",
          description: "Search files",
          parameters: {
            type: "object",
            properties: { pattern: { type: "string" } },
            required: ["pattern"]
          }
        }
      }
    ],
    reasoning_effort: "high",
    max_tokens: 128
  };
}

describe("Gemma 4 on Gemini API", () => {
  it("uses thinkingLevel rather than thinkingBudget", () => {
    expect(getCapabilitiesForModel("gemini", "gemma-4-31b-it")).toMatchObject({
      reasoning: true,
      thinkingFormat: "gemini-level"
    });

    const body = { reasoning_effort: "high" };
    applyThinking(FORMATS.GEMINI, "gemma-4-31b-it", body, "gemini");

    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: "high",
      includeThoughts: true
    });
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
  });

  it("does not replay synthetic thoughts or thought signatures in tool history", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemma-4-31b-it",
      gemmaToolBody(),
      false,
      { apiKey: "test" },
      "gemini"
    );

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("thoughtSignature");
    expect(serialized).not.toContain("internal reasoning should not be replayed");

    const modelTurn = out.contents.find((turn) => turn.role === "model");
    expect(modelTurn.parts).toContainEqual({ text: "I will check." });
    expect(modelTurn.parts).toContainEqual({
      functionCall: {
        id: "call_search",
        name: "search_files",
        args: { pattern: "x" }
      }
    });
  });

  it("keeps synthetic thought signatures for regular Gemini tool history", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "gemini-2.5-flash",
      gemmaToolBody(),
      false,
      { apiKey: "test" },
      "gemini"
    );

    const serialized = JSON.stringify(out);
    expect(serialized).toContain("thoughtSignature");
    expect(serialized).toContain("internal reasoning should not be replayed");
  });
});
