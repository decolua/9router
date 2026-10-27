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

  it("defers assistant role chunk on empty prefill thought part and synthesizes finish_reason on premature EOF after content", () => {
    const state = initState(FORMATS.OPENAI);
    // 1. Empty prefill chunk (thought: true, text: "") should NOT emit a standalone role chunk
    const prefill = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, {
      response: {
        responseId: "resp-prefill",
        modelVersion: "gemini-4-argon",
        candidates: [{ content: { role: "model", parts: [{ thought: true, text: "" }] } }],
        usageMetadata: { promptTokenCount: 173600, cachedContentTokenCount: 171551, totalTokenCount: 173600 },
      },
    }, state);
    expect(prefill).toEqual([]);
    expect(state.messageId).toBe("resp-prefill");

    // 2. Real content chunk emits role chunk + content chunk
    const delta = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, {
      response: {
        responseId: "resp-prefill",
        modelVersion: "gemini-4-argon",
        candidates: [{ content: { role: "model", parts: [{ text: "Hello world" }] } }],
      },
    }, state);
    expect(delta).toHaveLength(2);
    expect(delta[0].choices[0].delta).toEqual({ role: "assistant" });
    expect(delta[1].choices[0].delta).toEqual({ content: "Hello world" });

    // 3. Premature EOF (chunk = null) without finishReason synthesizes finish_reason: "stop"
    const flushed = translateResponse(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, state);
    expect(flushed).toHaveLength(1);
    expect(flushed[0].choices[0].finish_reason).toBe("stop");
  });

  it("peeks Antigravity SSE stream and fails over / rotates trajectory when stream ends with only empty prefill chunk", async () => {
    const executor = new AntigravityExecutor();
    const encoder = new TextEncoder();
    const emptyPrefillSse = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":""}]}}],"usageMetadata":{"promptTokenCount":100,"totalTokenCount":100},"modelVersion":"gemini-4-argon","responseId":"r1"}}\n\n'
        ));
        controller.close();
      },
    });
    const peek = await executor._peekSseFirstContent(new Response(emptyPrefillSse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    expect(peek.ok).toBe(false);
    expect(peek.status).toBe(502);
    expect(peek.message).toContain("without content or finishReason");
  });

  it("peeks Antigravity SSE stream and passes through when real thinking or text arrives after prefill", async () => {
    const executor = new AntigravityExecutor();
    const encoder = new TextEncoder();
    const validSse = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":""}]}}],"modelVersion":"gemini-4-argon","responseId":"r2"}}\n\n'
        ));
        controller.enqueue(encoder.encode(
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"Thinking..."}]}}],"modelVersion":"gemini-4-argon","responseId":"r2"}}\n\n'
        ));
        controller.enqueue(encoder.encode(
          'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Done"}]},"finishReason":"STOP"}],"modelVersion":"gemini-4-argon","responseId":"r2"}}\n\n'
        ));
        controller.close();
      },
    });
    const peek = await executor._peekSseFirstContent(new Response(validSse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }));
    expect(peek.ok).toBe(true);
    const replayedText = await new Response(peek.replacementBody).text();
    expect(replayedText).toContain("Thinking...");
    expect(replayedText).toContain('"finishReason":"STOP"');
  });
});
