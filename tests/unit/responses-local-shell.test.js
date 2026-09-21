import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
import { translateRequest, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { toLocalShellCall } from "../../open-sse/translator/concerns/localShell.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

const action = { type: "exec", command: ["echo", "OK"], env: {} };
const call = { id: "fc_shell", type: "local_shell_call", call_id: "call_shell", status: "completed", action };
const tools = [{ type: "local_shell" }];
const chunks = [
  { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_shell", function: { name: "local_shell", arguments: JSON.stringify(action) } }] }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
];

describe("Codex local shell through Command Code", () => {
  it("preserves the declaration, shell call and result on the next turn", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.COMMANDCODE, "test-model", {
      tools, input: [{ role: "user", content: "echo OK" }, call,
        { type: "local_shell_call_output", id: "call_shell", output: "OK" }],
    }, true, null, "commandcode");
    expect(out.params.tools[0]).toMatchObject({ name: "local_shell", input_schema: { required: ["command", "env"] } });
    expect(out.params.messages[1].content[0]).toMatchObject({ type: "tool-call", toolName: "local_shell", input: action });
    expect(out.params.messages[2].content[0]).toMatchObject({ type: "tool-result", toolName: "local_shell", toolCallId: "call_shell", output: { value: "OK" } });
  });

  it("emits executable shell items only after arguments are complete", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.localShell = true;
    const first = openaiToOpenAIResponsesResponse(chunks[0], state);
    expect(first.some(e => e.event === "response.output_item.added")).toBe(false);
    const events = openaiToOpenAIResponsesResponse(chunks[1], state);
    expect(events.find(e => e.event === "response.output_item.done").data.item).toEqual({ ...call, id: "fc_call_shell" });
    expect(events.some(e => e.event.startsWith("response.function_call_arguments."))).toBe(false);
    expect(events.at(-1).event).toBe("response.completed");
  });

  it("returns local_shell_call on a non-streaming retry", async () => {
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES, targetFormat: FORMATS.COMMANDCODE,
      provider: "commandcode", model: "test-model", body: { tools, input: "echo OK" },
      stream: false, requestStartTime: Date.now(), trackDone: vi.fn(), appendLog: vi.fn(),
    });
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.output[0]).toEqual({ ...call, id: "fc_call_shell" });
  });

  it("does not reinterpret an ordinary function named local_shell unless enabled", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    const events = chunks.flatMap(chunk => openaiToOpenAIResponsesResponse(chunk, state));
    expect(events.find(e => e.event === "response.output_item.done").data.item.type).toBe("function_call");
  });

  it("rejects invalid command arguments", () => {
    expect(() => toLocalShellCall({ type: "function_call", name: "local_shell", arguments: '{"command":"echo OK"}' })).toThrow("array of strings");
  });
});
