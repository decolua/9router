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
});

describe("Claude → Antigravity image preservation (direct route)", () => {
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const AG = (model, body) =>
    translateRequest(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, model, body, true, { accessToken: "t", email: "x@y.z" }, "antigravity");

  // claude-to-antigravity.js — pasted image in a user message was dropped by
  // wrapInCloudCodeEnvelopeForClaude (no CLAUDE_BLOCK.IMAGE branch). Now it must
  // survive as inlineData with the camelCase mimeType field.
  it("Claude-backed model keeps image in user message as inlineData", () => {
    const out = AG("claude-opus-4-6", {
      model: "claude-opus-4-6",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
        ],
      }],
    });
    const parts = out.request.contents[0].parts;
    const inline = parts.find((p) => p.inlineData);
    expect(inline, "image dropped for Claude model").toBeTruthy();
    expect(inline.inlineData.mimeType).toBe("image/png");
    expect(inline.inlineData.data).toBe(PNG);
  });

  // gemini.js convertOpenAIContentToParts produced mime_type (snake_case) while
  // the rest of the codebase (and Antigravity) reads mimeType. Normalized here.
  it("Gemini-backed model keeps image with camelCase mimeType", () => {
    const out = AG("gemini-3.6-flash-high", {
      model: "gemini-3.6-flash-high",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: PNG } },
        ],
      }],
    });
    const inline = out.request.contents[0].parts.find((p) => p.inlineData);
    expect(inline, "image dropped for Gemini model").toBeTruthy();
    expect(inline.inlineData.mimeType).toBe("image/jpeg");
    expect(JSON.stringify(out)).not.toContain("mime_type");
  });

  // claude-to-antigravity.js — image inside tool_result used to be stringified
  // into response.result (claude-to-openai). Now it must land in
  // functionResponse.parts[].inlineData, text stays in response.result.
  it("image inside tool_result lands in functionResponse.parts as inlineData", () => {
    const out = AG("claude-opus-4-6", {
      model: "claude-opus-4-6",
      messages: [
        { role: "user", content: "Read this image." },
        { role: "assistant", content: [{ type: "text", text: "OK" }] },
        { role: "user", content: [{
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
            { type: "text", text: "Here is the screenshot." },
          ],
        }] },
      ],
    });
    const last = out.request.contents[out.request.contents.length - 1];
    const funcResp = last.parts.find((p) => p.functionResponse);
    expect(funcResp).toBeTruthy();
    expect(funcResp.functionResponse.parts[0].inlineData.mimeType).toBe("image/png");
    expect(funcResp.functionResponse.parts[0].inlineData.data).toBe(PNG);
    expect(funcResp.functionResponse.response.result).toContain("Here is the screenshot.");
  });

  // Non-image request must keep the previous double-hop path (regression guard).
  it("non-image request still goes through the fallback (text preserved)", () => {
    const out = AG("claude-opus-4-6", {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(JSON.stringify(out.request.contents)).toContain("hello");
  });
});
