import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  openaiToAntigravityRequest,
  openaiToGeminiRequest,
} from "../../open-sse/translator/request/openai-to-gemini.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const EXEC_TOOL = {
  type: "custom",
  name: "exec",
  description: "Run JavaScript code to orchestrate tool calls.",
  format: {
    type: "grammar",
    syntax: "lark",
    definition: "start: /(.|\\n)+/",
  },
};

const NAMESPACED_EXEC_TOOL = {
  type: "namespace",
  name: "functions",
  description: "Callable workspace tools",
  tools: [EXEC_TOOL],
};

const request = () => ({
  input: [
    {
      type: "additional_tools",
      role: "developer",
      tools: [NAMESPACED_EXEC_TOOL],
    },
    { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd" }] },
  ],
  tool_choice: "auto",
});

const targets = [
  [FORMATS.OPENAI, "openai"],
  [FORMATS.CLAUDE, "claude"],
  [FORMATS.KIRO, "kiro"],
  [FORMATS.GEMINI, "gemini"],
  [FORMATS.GEMINI_CLI, "gemini-cli"],
  [FORMATS.ANTIGRAVITY, "antigravity"],
  [FORMATS.VERTEX, "vertex"],
  [FORMATS.OLLAMA, "ollama"],
  [FORMATS.COMMANDCODE, "commandcode"],
];

const TEST_CREDENTIALS = {
  projectId: "audit-project",
  connectionId: "audit-connection",
  email: "audit@example.com",
};

describe("Responses custom-tool metadata across provider translators", () => {
  it.each(targets)("preserves metadata through %s", (targetFormat, provider) => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      targetFormat,
      "test-model",
      request(),
      true,
      { connectionId: `test-${provider}`, providerSpecificData: {} },
      provider,
    );

    expect(out).toBeTruthy();
    expect(out._customToolNames).toEqual(["exec"]);
  });

  it("flattens namespace wrappers to their callable leaf tools", () => {
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "test-model",
      request(),
      true,
      { connectionId: "test-namespace", providerSpecificData: {} },
      "openai",
    );

    expect(out.tools).toEqual([{
      type: "function",
      function: expect.objectContaining({ name: "exec" }),
    }]);
    expect(out.tools.some((tool) => tool.function?.name === "functions")).toBe(false);
    expect(out._customToolNames).toEqual(["exec"]);
  });

  it("does not trust translator metadata supplied by a raw OpenAI client", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      "test-model",
      {
        messages: [{ role: "user", content: "test" }],
        _customToolNames: ["exec"],
        _toolNameMap: { exec_safe: "exec" },
      },
      true,
      {},
      "gemini",
    );

    expect(out).not.toHaveProperty("_customToolNames");
    expect(out).not.toHaveProperty("_toolNameMap");
  });

  it("does not reflect internal metadata on an untranslated request", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "test-model",
      {
        messages: [{ role: "user", content: "test" }],
        _customToolNames: ["exec"],
        _toolNameMap: { exec_safe: "exec" },
      },
      true,
      {},
      "openai",
    );

    expect(out).not.toHaveProperty("_customToolNames");
    expect(out).not.toHaveProperty("_toolNameMap");
  });

  it("round-trips a Gemini-normalized custom tool name", () => {
    const body = {
      messages: [{ role: "user", content: "test" }],
      tools: [{ type: "function", function: {
        name: "123tool",
        description: "custom",
        parameters: { type: "object", properties: {} },
      } }],
    };
    const gemini = openaiToGeminiRequest("test-model", body, true);
    expect(gemini._toolNameMap).toEqual(new Map([["_123tool", "123tool"]]));

    const state = { messageId: null, functionIndex: 0, toolNameMap: gemini._toolNameMap };
    const chunks = geminiToOpenAIResponse({
      response: {
        responseId: "gemini-1",
        modelVersion: "test-model",
        candidates: [{ content: { parts: [{ functionCall: { name: "_123tool", args: { input: "x" } } }] } }],
      },
    }, state);
    expect(chunks.find((chunk) => chunk.choices?.[0]?.delta?.tool_calls)?.choices[0].delta.tool_calls[0].function.name).toBe("123tool");
  });

  it("keeps colliding Gemini-normalized tool names unique", () => {
    const gemini = openaiToGeminiRequest("test-model", {
      messages: [{ role: "user", content: "test" }],
      tools: ["123tool", "_123tool"].map((name) => ({
        type: "function",
        function: { name, parameters: { type: "object", properties: {} } },
      })),
    }, true);
    const names = gemini.tools[0].functionDeclarations.map((tool) => tool.name);
    expect(new Set(names).size).toBe(2);
    expect(gemini._toolNameMap.get(names[0])).toBe("123tool");
    expect(gemini._toolNameMap.get(names[1])).toBe("_123tool");
  });

});

describe("Gemini-family tool names", () => {
  it("keeps colliding Antigravity-Claude tool names unique through executor normalization", () => {
    const translated = openaiToAntigravityRequest("claude-sonnet-4-5", {
      messages: [{ role: "user", content: "test" }],
      tools: ["123tool", "_123tool"].map((name) => ({
        type: "function",
        function: {
          name,
          parameters: { type: "object", properties: {} },
        },
      })),
    }, true, TEST_CREDENTIALS);
    const translatedNames = translated.request.tools[0].functionDeclarations
      .map((tool) => tool.name);
    const sent = new AntigravityExecutor().transformRequest(
      "claude-sonnet-4-5",
      structuredClone(translated),
      true,
      TEST_CREDENTIALS,
    );
    const sentNames = sent.request.tools[0].functionDeclarations.map((tool) => tool.name);
    const restoredNames = translatedNames.map((name) => translated._toolNameMap?.get(name) || name);

    expect({
      translatedCount: translatedNames.length,
      translatedUniqueCount: new Set(translatedNames).size,
      sentCount: sentNames.length,
      restoredUniqueCount: new Set(restoredNames).size,
    }).toEqual({
      translatedCount: 2,
      translatedUniqueCount: 2,
      sentCount: 2,
      restoredUniqueCount: 2,
    });
  });

  it("names a renamed tool identically in Antigravity-Claude declarations, calls and responses", () => {
    const translated = openaiToAntigravityRequest("claude-sonnet-4-5", {
      messages: [
        { role: "user", content: "test" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: "_123tool", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call_x", content: "done" },
      ],
      tools: ["123tool", "_123tool"].map((name) => ({
        type: "function",
        function: { name, parameters: { type: "object", properties: {} } },
      })),
    }, true, TEST_CREDENTIALS);
    const parts = translated.request.contents.flatMap((content) => content.parts || []);
    const callName = parts.find((part) => part.functionCall)?.functionCall.name;
    const responseName = parts.find((part) => part.functionResponse)?.functionResponse.name;
    const declared = translated.request.tools[0].functionDeclarations.map((tool) => tool.name);

    expect(declared).toContain(callName);
    expect(responseName).toBe(callName);
    expect(translated._toolNameMap.get(callName) || callName).toBe("_123tool");
  });

  it("carries the Gemini name map through the Gemini CLI envelope", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI_CLI,
      "gemini-2.5-pro",
      {
        messages: [{ role: "user", content: "test" }],
        tools: [{ type: "function", function: { name: "a/b", parameters: { type: "object", properties: {} } } }],
      },
      true,
      TEST_CREDENTIALS,
      "gemini-cli",
    );
    expect(out.request.tools[0].functionDeclarations[0].name).toBe("a_b");
    expect(out._toolNameMap).toEqual(new Map([["a_b", "a/b"]]));
  });
});
