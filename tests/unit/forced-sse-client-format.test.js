/**
 * A forceStream provider (claude-cli, opencode, zed, …) always answers with SSE.
 * When the client asked for JSON, handleForcedSSEToJson folds that stream back
 * into a single body — and that body has to be in the CLIENT's format.
 *
 * A Claude-format caller (`/v1/messages`, `stream:false`) was previously handed
 * an OpenAI `chat.completion` object it cannot parse.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

// Exactly the frame shape open-sse/executors/claude-cli.js emits.
function openAiSse({ content = "hello", toolCalls = null } = {}) {
  const base = { id: "chatcmpl-x1", object: "chat.completion.chunk", created: 1700000000, model: "claude-cli-haiku" };
  const frames = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
  ];
  if (toolCalls) {
    frames.push({ ...base, choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] });
  }
  frames.push({
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: toolCalls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 },
  });
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
}

function callHandler({ sourceFormat, sse = openAiSse() }) {
  return handleForcedSSEToJson({
    providerResponse: new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    sourceFormat,
    targetFormat: FORMATS.OPENAI,
    provider: "claude-cli",
    model: "claude-cli-haiku",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "noauth",
    apiKey: "sk-test",
    clientRawRequest: { endpoint: "/v1/messages" },
    onRequestSuccess: null,
    customToolNames: null,
    trackDone: () => {},
    appendLog: () => {},
    reqTag: "test",
    log: null,
  });
}

describe("forced SSE → JSON returns the client's format", () => {
  it("gives a Claude client an Anthropic message, not a chat.completion", async () => {
    const result = await callHandler({ sourceFormat: FORMATS.CLAUDE });
    expect(result.success).toBe(true);
    const body = await result.response.json();

    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body).not.toHaveProperty("choices");
    expect(body.content).toEqual([{ type: "text", text: "hello" }]);
    expect(body.stop_reason).toBe("end_turn");
    expect(body.usage).toMatchObject({ input_tokens: 11, output_tokens: 4 });
  });

  it("carries tool calls across as Claude tool_use blocks", async () => {
    const sse = openAiSse({
      content: "",
      toolCalls: [{ index: 0, id: "call_1", type: "function", function: { name: "shell", arguments: '{"cmd":"ls"}' } }],
    });
    const body = await (await callHandler({ sourceFormat: FORMATS.CLAUDE, sse })).response.json();

    const toolUse = body.content.find((block) => block.type === "tool_use");
    expect(toolUse).toMatchObject({ id: "call_1", name: "shell", input: { cmd: "ls" } });
    expect(body.stop_reason).toBe("tool_use");
  });

  it("leaves an OpenAI client's body untouched", async () => {
    const body = await (await callHandler({ sourceFormat: FORMATS.OPENAI })).response.json();
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("hello");
    expect(body.usage.prompt_tokens).toBe(11);
  });

  it("still converts for a Responses-API client", async () => {
    const body = await (await callHandler({ sourceFormat: FORMATS.OPENAI_RESPONSES })).response.json();
    expect(body.object).toBe("response");
    expect(body).not.toHaveProperty("choices");
  });
});
