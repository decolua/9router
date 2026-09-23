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

  it("preserves tool call and response pairing across turns with colliding call IDs (Gemini)", () => {
    const body = {
      messages: [
        { role: "user", content: "edit file" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_81334",
              type: "function",
              function: { name: "edit", arguments: JSON.stringify({ file: "foo.js" }) }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_81334",
          content: JSON.stringify({ success: true })
        },
        { role: "user", content: "run test" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_81334",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: "bun test" }) }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_81334",
          content: JSON.stringify({ passed: true })
        }
      ]
    };

    const out = openaiToAntigravityRequest("gemini-3.5-flash-low", body, true, {
      projectId: "project-1",
      connectionId: "conn-1"
    });

    const contents = out.request.contents;
    const modelContents = contents.filter((c) => c.role === "model");
    const userContents = contents.filter((c) => c.role === "user");

    const call1 = modelContents[0].parts.find((p) => p.functionCall)?.functionCall;
    const resp1 = userContents[1].parts.find((p) => p.functionResponse)?.functionResponse;
    const call2 = modelContents[1].parts.find((p) => p.functionCall)?.functionCall;
    const resp2 = userContents[2].parts.find((p) => p.functionResponse)?.functionResponse;

    expect(call1?.name).toBe("edit");
    expect(resp1?.name).toBe("edit");
    expect(resp1?.response?.result).toEqual({ success: true });
    expect(call1?.id).toBe("call_81334");
    expect(resp1?.id).toBe("call_81334");

    expect(call2?.name).toBe("bash");
    expect(resp2?.name).toBe("bash");
    expect(resp2?.response?.result).toEqual({ passed: true });
    expect(call2?.id).toBe("call_81334_1");
    expect(resp2?.id).toBe("call_81334_1");
  });

  it("preserves tool call and response pairing across turns with colliding call IDs (Claude backend)", () => {
    const body = {
      messages: [
        { role: "user", content: "edit file" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_81334",
              type: "function",
              function: { name: "edit", arguments: JSON.stringify({ file: "foo.js" }) }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_81334",
          content: JSON.stringify({ success: true })
        },
        { role: "user", content: "run test" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_81334",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ command: "bun test" }) }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_81334",
          content: JSON.stringify({ passed: true })
        }
      ]
    };

    const out = openaiToAntigravityRequest("claude-opus-4-6-thinking", body, true, {
      projectId: "project-1",
      connectionId: "conn-1"
    });

    const contents = out.request.contents;
    const modelContents = contents.filter((c) => c.role === "model");
    const userContents = contents.filter((c) => c.role === "user");

    const call1 = modelContents[0].parts.find((p) => p.functionCall)?.functionCall;
    const resp1 = userContents[1].parts.find((p) => p.functionResponse)?.functionResponse;
    const call2 = modelContents[1].parts.find((p) => p.functionCall)?.functionCall;
    const resp2 = userContents[2].parts.find((p) => p.functionResponse)?.functionResponse;

    expect(call1?.name).toBe("edit");
    expect(resp1?.name).toBe("edit");
    expect(resp1?.response?.result).toEqual({ success: true });
    expect(call1?.id).toBe("call_81334");
    expect(resp1?.id).toBe("call_81334");

    expect(call2?.name).toBe("bash");
    expect(resp2?.name).toBe("bash");
    expect(resp2?.response?.result).toEqual({ passed: true });
    expect(call2?.id).toBe("call_81334_1");
    expect(resp2?.id).toBe("call_81334_1");
  });

  it("handles parallel tool calls with identical IDs in the same turn without cross-talk", () => {
    const body = {
      messages: [
        { role: "user", content: "read files" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_dup",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: "a.txt" }) }
            },
            {
              id: "call_dup",
              type: "function",
              function: { name: "read_file", arguments: JSON.stringify({ path: "b.txt" }) }
            }
          ]
        },
        {
          role: "tool",
          tool_call_id: "call_dup",
          content: JSON.stringify({ data: "content A" })
        },
        {
          role: "tool",
          tool_call_id: "call_dup",
          content: JSON.stringify({ data: "content B" })
        }
      ]
    };

    const out = openaiToAntigravityRequest("gemini-3.5-flash-low", body, true, {
      projectId: "project-1",
      connectionId: "conn-1"
    });

    const contents = out.request.contents;
    const modelContent = contents.find((c) => c.role === "model");
    const userToolContent = contents.find((c) => c.role === "user" && c.parts.some((p) => p.functionResponse));

    const calls = modelContent.parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    const resps = userToolContent.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse);

    expect(calls).toHaveLength(2);
    expect(resps).toHaveLength(2);

    expect(calls[0].id).toBe("call_dup");
    expect(resps[0].id).toBe("call_dup");
    expect(resps[0].name).toBe("read_file");
    expect(resps[0].response?.result).toEqual({ data: "content A" });

    expect(calls[1].id).toBe("call_dup_1");
    expect(resps[1].id).toBe("call_dup_1");
    expect(resps[1].name).toBe("read_file");
    expect(resps[1].response?.result).toEqual({ data: "content B" });
  });
});
