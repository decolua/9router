import { describe, it, expect } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import {
  canonicalizeKiroConversation,
  KIRO_TOOL_RESULTS_PLACEHOLDER,
  KIRO_EMPTY_USER_PLACEHOLDER,
} from "../../open-sse/translator/concerns/kiroConversation.js";

const TOOLS_OPENAI = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Get weather",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
}];

const TOOLS_CLAUDE = [{
  name: "get_weather",
  description: "Get weather",
  input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
}];

function allUserContents(payload) {
  const state = payload.conversationState;
  return [
    ...state.history.filter((t) => t.userInputMessage).map((t) => t.userInputMessage.content),
    state.currentMessage.userInputMessage.content,
  ];
}

describe("Kiro tool-result-only turns", () => {
  it("OpenAI → Kiro: tool message gets a neutral placeholder, not \"continue\"", () => {
    const payload = openaiToKiroRequest("claude-sonnet-4.6", {
      tools: TOOLS_OPENAI,
      messages: [
        { role: "user", content: "The secret word is PINEAPPLE. Weather in Jakarta?" },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Jakarta\"}" } }] },
        { role: "tool", tool_call_id: "call_1", content: "32C, humid" },
      ],
    }, true, {});

    const current = payload.conversationState.currentMessage.userInputMessage;
    expect(current.content).toContain(KIRO_TOOL_RESULTS_PLACEHOLDER);
    expect(current.content).not.toMatch(/\bcontinue\b/);
    expect(current.userInputMessageContext.toolResults).toHaveLength(1);
    expect(allUserContents(payload).join("\n")).toContain("PINEAPPLE");
  });

  it("Claude → Kiro: tool_result-only user message gets a neutral placeholder", () => {
    const payload = claudeToKiroRequest("claude-sonnet-4.6", {
      tools: TOOLS_CLAUDE,
      messages: [
        { role: "user", content: "The secret word is PINEAPPLE. Weather in Jakarta?" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Jakarta" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "32C, humid" }] },
      ],
    }, true, {});

    const current = payload.conversationState.currentMessage.userInputMessage;
    expect(current.content).toContain(KIRO_TOOL_RESULTS_PLACEHOLDER);
    expect(current.content).not.toMatch(/\bcontinue\b/);
    expect(current.userInputMessageContext.toolResults).toHaveLength(1);
  });

  it("keeps real user text when a turn has both text and tool results", () => {
    const payload = claudeToKiroRequest("claude-sonnet-4.6", {
      tools: TOOLS_CLAUDE,
      messages: [
        { role: "user", content: "Weather in Jakarta?" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Jakarta" } }] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "32C" },
          { type: "text", text: "Now answer in one word." },
        ] },
      ],
    }, true, {});

    const current = payload.conversationState.currentMessage.userInputMessage;
    expect(current.content).toContain("Now answer in one word.");
    expect(current.content).not.toContain(KIRO_TOOL_RESULTS_PLACEHOLDER);
  });

  it("canonicalize: history turn with tool results and no text uses the placeholder", () => {
    const result = canonicalizeKiroConversation({
      history: [
        { userInputMessage: { content: "Weather in Jakarta?", modelId: "m" } },
        { assistantResponseMessage: { content: "", toolUses: [{ toolUseId: "t1", name: "get_weather", input: { city: "Jakarta" } }] } },
        { userInputMessage: { content: "", modelId: "m", userInputMessageContext: { toolResults: [{ toolUseId: "t1", status: "success", content: [{ text: "32C" }] }] } } },
        { assistantResponseMessage: { content: "It is 32C." } },
      ],
      currentMessage: { userInputMessage: { content: "Hot or cold?", modelId: "m" } },
      modelId: "m",
      toolSpecs: [{ toolSpecification: { name: "get_weather", description: "Get weather", inputSchema: { json: { type: "object", properties: {} } } } }],
      nameMap: new Map([["get_weather", "get_weather"]]),
    });

    expect(result.valid).toBe(true);
    expect(result.history[2].userInputMessage.content).toBe(KIRO_TOOL_RESULTS_PLACEHOLDER);
  });

  it("canonicalize: an empty turn without tool results still falls back to \"continue\"", () => {
    const result = canonicalizeKiroConversation({
      history: [{ assistantResponseMessage: { content: "Hello" } }],
      currentMessage: { userInputMessage: { content: "", modelId: "m" } },
      modelId: "m",
      toolSpecs: [],
      nameMap: new Map(),
    });

    expect(result.history[0].userInputMessage.content).toBe(KIRO_EMPTY_USER_PLACEHOLDER);
    expect(result.currentMessage.userInputMessage.content).toBe(KIRO_EMPTY_USER_PLACEHOLDER);
  });
});
