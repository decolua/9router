import { afterEach, describe, expect, it, vi } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";
import { openaiToCommandCodeRequest } from "../../open-sse/translator/request/openai-to-commandcode.js";

afterEach(() => vi.unstubAllGlobals());

const options = {
  enabled: true, url: "http://headroom:8787", model: "test-model", format: "commandcode",
};

function makeBody() {
  return openaiToCommandCodeRequest("test-model", {
    messages: [
      { role: "system", content: "long system instructions" },
      { role: "user", content: [
        { type: "text", text: "long user request" },
        { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        { type: "text", text: "more user context" },
      ] },
      { role: "assistant", reasoning_content: "private reasoning", tool_calls: [
        { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.js"}' } },
        { id: "call_2", type: "function", function: { name: "read_file", arguments: '{"path":"b.js"}' } },
      ] },
      { role: "tool", tool_call_id: "call_1", name: "read_file", content: "long file a output" },
      { role: "tool", tool_call_id: "call_2", name: "read_file", content: "long file b output" },
      { role: "user", content: "please continue" },
    ],
    tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object" } } }],
  }, true);
}

function mockProxy(mapMessages) {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const payload = JSON.parse(init.body);
    return new Response(JSON.stringify({
      messages: mapMessages(payload.messages), tokens_before: 100, tokens_after: 40, tokens_saved: 60,
    }));
  }));
}

describe("CommandCode Headroom compression", () => {
  it("compresses native text and tool outputs while preserving the provider envelope", async () => {
    const body = makeBody();
    const expected = structuredClone(body);
    const diagnostics = {};
    mockProxy((messages) => messages.map((message, i) => ({
      ...message, content: message.content ? `short ${i}` : "",
    })));

    const stats = await compressWithHeadroom(body, { ...options, compressUserMessages: true, diagnostics });

    expect(stats?.tokens_saved).toBe(60);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.config).toEqual({ compress_user_messages: true });
    expect(payload.messages).toEqual([
      { role: "system", content: "long system instructions" },
      { role: "user", content: "long user request" },
      { role: "user", content: "more user context" },
      { role: "assistant", content: "", tool_calls: [
        { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.js"}' } },
        { id: "call_2", type: "function", function: { name: "read_file", arguments: '{"path":"b.js"}' } },
      ] },
      { role: "tool", content: "long file a output", tool_call_id: "call_1", name: "read_file" },
      { role: "tool", content: "long file b output", tool_call_id: "call_2", name: "read_file" },
      { role: "user", content: "please continue" },
    ]);
    expected.params.system = "short 0";
    expected.params.messages[0].content[0].text = "short 1";
    expected.params.messages[0].content[2].text = "short 2";
    expected.params.messages[2].content[0].output.value = "short 4";
    expected.params.messages[3].content[0].output.value = "short 5";
    expected.params.messages[4].content[0].text = "short 6";
    expect(body).toEqual(expected);
    expect(diagnostics.before.messageBytes).toBeGreaterThan(0);
    expect(diagnostics.before.toolSchemaBytes).toBeGreaterThan(2);
    expect(diagnostics.after.messageBytes).toBeLessThan(diagnostics.before.messageBytes);
    expect(diagnostics.after.toolHistoryBytes).toBeLessThan(diagnostics.before.toolHistoryBytes);
  });

  it("accepts text-block responses and preserves non-text tool outputs", async () => {
    const body = { params: { messages: [
      { role: "assistant", content: [{ type: "text", text: "long response" }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_json", output: { type: "json", value: { count: 42 } } }] },
    ] } };
    const expected = structuredClone(body);
    expected.params.messages[0].content[0].text = "short";
    mockProxy((messages) => messages.map((message) => ({ ...message, content: [{ type: "text", text: "short" }] })));

    expect(await compressWithHeadroom(body, options)).not.toBeNull();
    expect(body).toEqual(expected);
  });

  it.each([
    ["missing messages", (messages) => messages.slice(1)],
    ["wrong role", (messages) => messages.map((message, i) => i === 1 ? { ...message, role: "assistant" } : message)],
    ["reordered tool results", (messages) => { [messages[4], messages[5]] = [messages[5], messages[4]]; return messages; }],
    ["missing text", (messages) => messages.map((message, i) => i === 5 ? { ...message, content: null } : { ...message, content: "short" })],
  ])("fails open without partial mutation for %s", async (_name, mapMessages) => {
    const body = makeBody();
    const original = structuredClone(body);
    const diagnostics = {};
    mockProxy(mapMessages);

    const stats = await compressWithHeadroom(body, { ...options, diagnostics });

    expect(fetch).toHaveBeenCalledOnce();
    expect(stats).toBeNull();
    expect(body).toEqual(original);
    expect(diagnostics.reason).toMatch(/CommandCode/);
  });

  it("leaves the request intact when the proxy is unavailable", async () => {
    const body = makeBody();
    const original = structuredClone(body);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));

    expect(await compressWithHeadroom(body, options)).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    expect(body).toEqual(original);
  });
});
