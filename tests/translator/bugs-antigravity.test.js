// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";
import { ANTIGRAVITY_DEFAULT_SYSTEM } from "../../open-sse/config/appConstants.js";

const AG2O = (req) =>
  translateRequest(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, "m", { request: req }, true, null, null);

describe("Antigravity → OpenAI", () => {
  // antigravity-to-openai.js — content with BOTH functionResponse and functionCall/text
  // previously returned toolResults early → dropped tool calls / text (fixed in #2225)
  it("functionResponse + functionCall in same content keeps both", () => {
    const out = AG2O({
      contents: [{
        role: "model",
        parts: [
          { functionResponse: { id: "c1", name: "prev", response: { result: "done" } } },
          { functionCall: { id: "c2", name: "next", args: {} } },
        ],
      }],
    });
    const json = JSON.stringify(out);
    expect(json, "functionCall lost when sharing content with functionResponse").toContain("\"next\"");
  });

  // antigravity-to-openai.js:167 — functionCall without id gets a random Date.now() id
  // KNOWN BUG: unstable id breaks matching with its functionResponse
  it("functionCall without id keeps a stable matchable id", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "search", args: { q: "x" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "search", response: { result: "r" } } }] },
      ],
    });
    const asst = out.messages.find((m) => m.tool_calls);
    const tool = out.messages.find((m) => m.role === "tool");
    expect(tool?.tool_call_id, "id mismatch between call and response").toBe(asst?.tool_calls?.[0]?.id);
  });

  // antigravity-to-openai.js:144-147 — signature-only part handling (regression guard)
  it("signature-only part does not produce empty text", () => {
    const out = AG2O({
      contents: [{ role: "model", parts: [{ thoughtSignature: "sig", text: "" }] }],
    });
    const asst = out.messages.find((m) => m.role === "assistant");
    const content = asst?.content;
    const hasEmpty = Array.isArray(content)
      ? content.some((c) => c.type === "text" && c.text === "")
      : content === "";
    expect(hasEmpty, "empty text part emitted").toBe(false);
  });
});

describe("Antigravity → Claude", () => {
  it("tool call input_json_delta includes Anthropic index", () => {
    const state = initState(FORMATS.CLAUDE);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, {
      response: {
        responseId: "resp-1",
        modelVersion: "gemini-pro-agent",
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { name: "bash", args: { command: "git status" } } }],
          },
          finishReason: "STOP",
          index: 0,
        }],
      },
    }, state);

    const jsonDelta = events.find(
      (event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta"
    );
    expect(jsonDelta).toMatchObject({ index: expect.any(Number) });
    expect(JSON.parse(jsonDelta.delta.partial_json)).toEqual({ command: "git status" });
  });
});

describe("Antigravity executor", () => {
  it("strips optional from nested tool schemas", () => {
    const out = new AntigravityExecutor().transformRequest("gemini-2.5-pro", {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{
          functionDeclarations: [{
            name: "lookup",
            description: "Lookup a value",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query",
                  optional: true,
                },
              },
            },
          }],
        }],
      },
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const query = out.request.tools[0].functionDeclarations[0].parameters.properties.query;
    expect(query).toEqual({ type: "string", description: "Search query" });
  });

  it("does not inject the legacy Antigravity default system prompt for Gemini-backed models", () => {
    const out = openaiToAntigravityRequest("gemini-3.5-flash-low", {
      messages: [
        { role: "system", content: "USER_SYSTEM_PROMPT" },
        { role: "user", content: "hello" },
      ],
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const system = JSON.stringify(out.request.systemInstruction);
    expect(system).toContain("USER_SYSTEM_PROMPT");
    expect(system).not.toContain(ANTIGRAVITY_DEFAULT_SYSTEM);
    expect(system).not.toContain("Please ignore the following [ignore]");
  });

  it("does not inject the legacy Antigravity default system prompt for Claude-backed models", () => {
    const out = openaiToAntigravityRequest("claude-opus-4-6-thinking", {
      messages: [
        { role: "system", content: "USER_SYSTEM_PROMPT" },
        { role: "user", content: "hello" },
      ],
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const system = JSON.stringify(out.request.systemInstruction);
    expect(system).toContain("USER_SYSTEM_PROMPT");
    expect(system).not.toContain(ANTIGRAVITY_DEFAULT_SYSTEM);
    expect(system).not.toContain("Please ignore the following [ignore]");
  });

  it("multiple calls to the same tool name in different turns get unique stable IDs", () => {
    const out = AG2O({
      contents: [
        { role: "model", parts: [{ functionCall: { name: "grep_search", args: { query: "hello" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "grep_search", response: { result: "res1" } } }] },
        { role: "model", parts: [{ functionCall: { name: "grep_search", args: { query: "world" } } }] },
        { role: "user", parts: [{ functionResponse: { name: "grep_search", response: { result: "res2" } } }] },
      ],
    });

    const calls = out.messages.filter((m) => m.role === "assistant" && m.tool_calls);
    const tools = out.messages.filter((m) => m.role === "tool");

    expect(calls.length).toBe(2);
    expect(tools.length).toBe(2);

    const call1Id = calls[0].tool_calls[0].id;
    const call2Id = calls[1].tool_calls[0].id;
    const tool1Id = tools[0].tool_call_id;
    const tool2Id = tools[1].tool_call_id;

    // Check that tool call IDs are unique
    expect(call1Id).not.toBe(call2Id);
    
    // Check that the tool response IDs match the corresponding tool call IDs
    expect(tool1Id).toBe(call1Id);
    expect(tool2Id).toBe(call2Id);
  });

  it("openaiToAntigravityRequest preserves empty string tool responses without dropping functionResponse", () => {
    const out = openaiToAntigravityRequest("gemini-3.6-flash-high", {
      messages: [
        { role: "user", content: "find files" },
        {
          role: "assistant",
          tool_calls: [{
            id: "call_abc123",
            type: "function",
            function: { name: "grep_search", arguments: '{"query":"test"}' }
          }]
        },
        {
          role: "tool",
          tool_call_id: "call_abc123",
          content: "" // empty tool response output
        }
      ]
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const contents = out.request.contents;
    expect(contents.length).toBe(3); // user -> model -> user (functionResponse)
    const lastTurn = contents[2];
    expect(lastTurn.role).toBe("user");
    expect(lastTurn.parts[0].functionResponse).toBeDefined();
    expect(lastTurn.parts[0].functionResponse.name).toBe("grep_search");
    expect(lastTurn.parts[0].functionResponse.response).toEqual({ result: "" });
  });

  it("openaiToAntigravityRequest normalizes trailing model turn to end with user turn", () => {
    const out = openaiToAntigravityRequest("gemini-3.6-flash-high", {
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" }
      ]
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const contents = out.request.contents;
    const lastTurn = contents[contents.length - 1];
    expect(lastTurn.role).toBe("user");
  });

  it("openaiToAntigravityRequest wraps JSON array tool outputs into an object to prevent Protobuf Proto field list error", () => {
    const out = openaiToAntigravityRequest("gemini-3.6-flash-high", {
      messages: [
        { role: "user", content: "find files" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_search_1",
              type: "function",
              function: { name: "search", arguments: "{}" }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_search_1",
          content: JSON.stringify([{ file: "index.js", line: 10 }, { file: "app.js", line: 20 }])
        }
      ]
    }, true, { projectId: "project-1", connectionId: "conn-1" });

    const contents = out.request.contents;
    const toolTurn = contents.find((c) => c.parts?.some((p) => p.functionResponse));
    expect(toolTurn).toBeDefined();
    const fnResp = toolTurn.parts[0].functionResponse;
    expect(fnResp.name).toBe("search");
    expect(Array.isArray(fnResp.response)).toBe(false);
    expect(typeof fnResp.response).toBe("object");
    expect(fnResp.response).toEqual({
      result: [{ file: "index.js", line: 10 }, { file: "app.js", line: 20 }]
    });
  });
});
