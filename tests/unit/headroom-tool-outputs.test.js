import { afterEach, describe, expect, it, vi } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

afterEach(() => vi.unstubAllGlobals());

const longText = "search result: file.js matches the requested symbol\n".repeat(100);
const options = { enabled: true, url: "http://headroom:8787", model: "test-model" };

function geminiBody(envelope = false) {
  const request = {
    systemInstruction: { parts: [{ text: "preserve instructions" }] },
    tools: [{ functionDeclarations: [{ name: "search", parameters: { type: "object" } }] }],
    contents: [
      { role: "model", parts: [
        { functionCall: { id: "call_1", name: "search", args: { query: "symbol" } }, thoughtSignature: "signature" },
      ] },
      { role: "user", parts: [
        { functionResponse: { id: "call_1", name: "search", response: {
          result: { content: [{ type: "text", text: longText }, { type: "image", data: "untouched image" }] },
          metadata: { text: longText },
          output: '{"text":"preserve JSON string"}',
        } } },
        { text: "preserve user request" },
        { inlineData: { mimeType: "image/png", data: "base64 data" } },
      ] },
    ],
  };
  return envelope ? { project: "test-project", model: "test-model", request } : request;
}

function responsesBody() {
  return { model: "test-model", instructions: "preserve instructions", input: [
    { type: "reasoning", id: "rs_1", encrypted_content: "encrypted reasoning" },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "search", arguments: '{"query":"symbol"}' },
    { type: "function_call_output", call_id: "call_1", output: longText },
    { type: "function_call_output", call_id: "call_2", output: [
      { type: "input_text", text: longText }, { type: "input_image", image_url: "data:image/png;base64,data" },
    ] },
    { type: "web_search_call", id: "ws_1", status: "completed", action: { query: "symbol" } },
    { role: "user", content: "preserve user request" },
  ] };
}

function proxy(transform = (messages) => messages.map((message) => ({ ...message, content: "short result" }))) {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => new Response(JSON.stringify({
    messages: transform(JSON.parse(init.body).messages), tokens_before: 2000, tokens_after: 20, tokens_saved: 1980,
  }))));
}

describe("Headroom native tool-output compression", () => {
  it.each([
    ["gemini", false], ["gemini-cli", true], ["antigravity", true], ["vertex", false],
  ])("compresses only eligible %s tool text and preserves the native request", async (format, envelope) => {
    const body = geminiBody(envelope);
    const expected = structuredClone(body);
    (envelope ? expected.request : expected).contents[1].parts[0].functionResponse.response.result.content[0].text = "short result";
    const diagnostics = {};
    proxy();

    const stats = await compressWithHeadroom(body, { ...options, format, diagnostics });

    expect(stats?.tokens_saved).toBe(1980);
    expect(body).toEqual(expected);
    const sent = JSON.parse(fetch.mock.calls[0][1].body).messages;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ role: "tool", content: longText, tool_call_id: expect.any(String) });
    expect(diagnostics.after.messageBytes).toBeLessThan(diagnostics.before.messageBytes);
    expect(diagnostics.after.toolHistoryBytes).toBeLessThan(diagnostics.before.toolHistoryBytes);
    expect(diagnostics.after.toolSchemaBytes).toBe(diagnostics.before.toolSchemaBytes);
  });

  it("compresses Responses tool strings and text parts without round-tripping protocol items", async () => {
    const body = responsesBody();
    const expected = structuredClone(body);
    expected.input[2].output = "short result";
    expected.input[3].output[0].text = "short result";
    proxy();

    expect(await compressWithHeadroom(body, { ...options, format: "openai-responses" })).not.toBeNull();
    expect(body).toEqual(expected);
    const sent = JSON.parse(fetch.mock.calls[0][1].body).messages;
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((message) => message.tool_call_id)).size).toBe(2);
  });

  it.each([
    ["message count", (messages) => messages.slice(1)],
    ["roles", (messages) => messages.map((message, i) => i ? { ...message, role: "user" } : message)],
    ["IDs/order", (messages) => messages.reverse()],
    ["missing IDs", (messages) => messages.map(({ tool_call_id, ...message }) => message)],
    ["non-string text", (messages) => messages.map((message, i) => i ? { ...message, content: {} } : message)],
  ])("fails open atomically when the proxy changes %s", async (_name, transform) => {
    const body = responsesBody();
    const original = structuredClone(body);
    const diagnostics = {};
    proxy(transform);

    expect(await compressWithHeadroom(body, { ...options, format: "openai-responses", diagnostics })).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toMatch(/tool/);
  });

  it.each(["", longText + "larger"])("preserves original text for an empty or larger result", async (content) => {
    const body = responsesBody();
    const original = structuredClone(body);
    proxy((messages) => messages.map((message) => ({ ...message, content })));

    await compressWithHeadroom(body, { ...options, format: "openai-responses" });

    expect(fetch).toHaveBeenCalledOnce();
    expect(body).toEqual(original);
  });

  it("leaves the body untouched when the compression proxy is unavailable", async () => {
    const body = geminiBody(true);
    const original = structuredClone(body);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    expect(await compressWithHeadroom(body, { ...options, format: "antigravity" })).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(body).toEqual(original);
  });

  it("does not send structured JSON, images, or user instructions to the proxy", async () => {
    const body = { input: [
      { type: "function_call_output", call_id: "call_1", output: '{"content":"structured data"}' },
      { type: "function_call_output", call_id: "call_2", output: [{ type: "input_image", image_url: "image" }] },
      { role: "user", content: longText },
    ] };
    const original = structuredClone(body);
    vi.stubGlobal("fetch", vi.fn());

    expect(await compressWithHeadroom(body, { ...options, format: "openai-responses" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });

  it("bounds traversal of deeply nested tool output", async () => {
    let response = { text: longText };
    for (let i = 0; i < 20; i++) response = { result: response };
    const body = { contents: [{ role: "user", parts: [{ functionResponse: { name: "search", response } }] }] };
    const original = structuredClone(body);
    vi.stubGlobal("fetch", vi.fn());

    expect(await compressWithHeadroom(body, { ...options, format: "gemini" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(body).toEqual(original);
  });
});
