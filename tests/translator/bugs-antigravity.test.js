// Real Antigravity-MITM requests (Gemini-internal: { request: { contents, ... } }) → OpenAI.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

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
});

// Stability fixes: empty/aborted Antigravity streams must never surface as clean
// end_turn to Claude Code (#2188, #2229, #2250, #2259, #2431).
describe("Antigravity → OpenAI stream stability", () => {
  const wrap = (response) => ({ response });

  // concerns/finishReason.js — MALFORMED_FUNCTION_CALL used to fall through the
  // default case to "stop" → end_turn: the model narrates a tool call, Gemini
  // aborts it, and the client thinks the turn finished cleanly (#2250).
  it("MALFORMED_FUNCTION_CALL maps to error finish, not stop", () => {
    const state = initState(FORMATS.OPENAI);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r1", modelVersion: "gemini-pro-agent",
      candidates: [{ content: { role: "model", parts: [{ text: "I'll call the tool now." }] }, index: 0 }],
    }), state);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", index: 0 }],
    }), state);
    const finish = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("error");
  });

  // gemini-to-openai.js — an error finish must not be upgraded to tool_calls even
  // when a functionCall was emitted earlier in the stream.
  it("error finish is not upgraded to tool_calls", () => {
    const state = initState(FORMATS.OPENAI);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r2", modelVersion: "gemini-pro-agent",
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "bash", args: { command: "ls" } } }] }, index: 0 }],
    }), state);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      candidates: [{ finishReason: "UNEXPECTED_TOOL_CALL", index: 0 }],
    }), state);
    const finish = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("error");
  });

  it("STOP with emitted tool call still upgrades to tool_calls", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r3", modelVersion: "gemini-pro-agent",
      candidates: [{
        content: { role: "model", parts: [{ functionCall: { name: "bash", args: { command: "ls" } } }] },
        finishReason: "STOP", index: 0,
      }],
    }), state);
    const finish = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("tool_calls");
  });

  // gemini-to-openai.js — candidate-less chunk with promptFeedback.blockReason was
  // dropped (return null) → empty 200 stream that never closes (#2188).
  it("promptFeedback-only chunk closes the stream as content_filter", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r4", modelVersion: "gemini-pro-agent",
      promptFeedback: { blockReason: "SAFETY" },
    }), state);
    const finish = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("content_filter");
  });

  // gemini-to-openai.js — a {error:{...}} object embedded mid-stream in a 200
  // response was dropped silently (#2259, #2431).
  it("mid-stream error object closes the stream with an error finish", () => {
    const state = initState(FORMATS.OPENAI);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r5", modelVersion: "gemini-pro-agent",
      candidates: [{ content: { role: "model", parts: [{ text: "partial" }] }, index: 0 }],
    }), state);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" },
    }), state);
    const finish = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe("error");
    expect(state.upstreamError).toMatchObject({ status: "RESOURCE_EXHAUSTED" });
  });

  // gemini-to-openai.js — usage-only keep-alive chunks must stay silent but keep usage.
  it("candidate-less usage chunk returns nothing but preserves usage", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    }), state);
    expect(events).toEqual([]);
    expect(state.usage).toBeTruthy();
  });

  // gemini-to-openai.js — upstream functionCall.id was discarded and replaced by a
  // regenerated name-based id, breaking functionResponse matching on replay.
  it("upstream functionCall.id is preserved on the tool_call", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r6", modelVersion: "gemini-pro-agent",
      candidates: [{
        content: { role: "model", parts: [{ functionCall: { id: "call_abc123", name: "bash", args: {} } }] },
        finishReason: "STOP", index: 0,
      }],
    }), state);
    const toolChunk = events.find((e) => e.choices?.[0]?.delta?.tool_calls);
    expect(toolChunk.choices[0].delta.tool_calls[0].id).toBe("call_abc123");
  });

  it("generated tool ids use underscore separators and the Anthropic charset", () => {
    const state = initState(FORMATS.OPENAI);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, wrap({
      responseId: "r7", modelVersion: "gemini-pro-agent",
      candidates: [{
        content: { role: "model", parts: [{ functionCall: { name: "my-tool", args: {} } }] },
        finishReason: "STOP", index: 0,
      }],
    }), state);
    const toolChunk = events.find((e) => e.choices?.[0]?.delta?.tool_calls);
    expect(toolChunk.choices[0].delta.tool_calls[0].id).toMatch(/^my-tool_\d+_0$/);
  });
});

// Claude-side stream finalization: truncated/aborted Antigravity streams must
// always yield a well-formed Claude SSE sequence (#2229, #2259, #2431).
describe("Antigravity → Claude stream finalization", () => {
  const wrap = (response) => ({ response });
  const textChunk = (text) => wrap({
    responseId: "resp-x", modelVersion: "gemini-pro-agent",
    candidates: [{ content: { role: "model", parts: [{ text }] }, index: 0 }],
  });

  // openai-to-claude.js — stream ends without finishReason (connection dropped):
  // the message was never closed, Claude Code hung on a dangling message.
  it("flush closes a stream that ended without finishReason", () => {
    const state = initState(FORMATS.CLAUDE);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, textChunk("partial answer"), state);
    const flushed = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, state);
    const types = flushed.map((e) => e.type);
    expect(types).toContain("content_block_stop");
    expect(types).toContain("message_delta");
    expect(types).toContain("message_stop");
    const delta = flushed.find((e) => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("end_turn");
  });

  it("flush after a handled finish emits nothing", () => {
    const state = initState(FORMATS.CLAUDE);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, wrap({
      responseId: "resp-y", modelVersion: "gemini-pro-agent",
      candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP", index: 0 }],
    }), state);
    const flushed = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, state);
    expect(flushed).toEqual([]);
  });

  // openai-to-claude.js — a truncated stream with an unfinished tool call must
  // still flush the buffered input_json_delta and close as tool_use.
  it("flush finalizes an unfinished tool call as tool_use", () => {
    const state = initState(FORMATS.CLAUDE);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, wrap({
      responseId: "resp-z", modelVersion: "gemini-pro-agent",
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "bash", args: { command: "ls" } } }] }, index: 0 }],
    }), state);
    const flushed = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, null, state);
    const jsonDelta = flushed.find((e) => e.delta?.type === "input_json_delta");
    expect(JSON.parse(jsonDelta.delta.partial_json)).toEqual({ command: "ls" });
    const delta = flushed.find((e) => e.type === "message_delta");
    expect(delta.delta.stop_reason).toBe("tool_use");
    expect(flushed.map((e) => e.type)).toContain("message_stop");
  });

  // openai-to-claude.js — duplicate finish_reason chunks (common from
  // OpenAI-compatible upstreams) must not emit message_stop twice.
  it("duplicate finish chunks emit a single message_stop", () => {
    const state = initState(FORMATS.CLAUDE);
    const first = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, wrap({
      responseId: "resp-d", modelVersion: "gemini-pro-agent",
      candidates: [{ content: { role: "model", parts: [{ text: "hi" }] }, finishReason: "STOP", index: 0 }],
    }), state);
    const second = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, wrap({
      candidates: [{ finishReason: "STOP", index: 0 }],
    }), state);
    const stops = [...first, ...second].filter((e) => e.type === "message_stop");
    expect(stops).toHaveLength(1);
  });

  // Full pivot: MALFORMED_FUNCTION_CALL must reach the Claude client as an error
  // event, never as a clean end_turn (#2250).
  it("MALFORMED_FUNCTION_CALL surfaces as an error event, not end_turn", () => {
    const state = initState(FORMATS.CLAUDE);
    translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, textChunk("I'll run the command now."), state);
    const events = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, wrap({
      candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", index: 0 }],
    }), state);
    const error = events.find((e) => e.type === "error");
    expect(error).toBeTruthy();
    expect(error.error.type).toBe("api_error");
    const endTurn = events.find((e) => e.type === "message_delta" && e.delta?.stop_reason === "end_turn");
    expect(endTurn).toBeUndefined();
  });
});
