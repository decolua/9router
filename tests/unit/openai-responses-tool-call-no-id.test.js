// Item 5 — a tool-call fragment without an id is dropped on the openai→Responses
// path. translator/response/openai-responses.js stored the call id only when the
// fragment carried one, announced the item only when an id existed, and
// closeToolCall() required it — so a provider that streams
// `tool_calls:[{index,function:{name,arguments}}]` with no id produced a
// response.completed with no function_call item at all.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function feed(sseText, transform) {
  const input = new Blob([sseText]).stream();
  return drain(input.pipeThrough(transform));
}

const oa = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const chatChunk = (delta, finish = null) => ({
  id: "chatcmpl-abcdef123456",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-x",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function responsesEvents(text, type) {
  const out = [];
  for (const frame of text.split("\n\n")) {
    if (!frame.includes(`event: ${type}`)) continue;
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    if (dataLine) out.push(JSON.parse(dataLine.slice(6)));
  }
  return out;
}

describe("openai→Responses — tool_call fragments without an id", () => {
  it("mints a stable call id and emits the function_call item", async () => {
    const upstream =
      oa(chatChunk({
        role: "assistant",
        tool_calls: [{ index: 0, type: "function", function: { name: "Read", arguments: '{"file_path":' } }],
      })) +
      oa(chatChunk({ tool_calls: [{ index: 0, function: { arguments: '"/x"}' } }] })) +
      oa(chatChunk({}, "tool_calls")) +
      "data: [DONE]\n\n";

    const out = await feed(
      upstream,
      createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "openai", null, null, "gpt-x")
    );

    const added = responsesEvents(out, "response.output_item.added")
      .filter((event) => event.item?.type === "function_call");
    expect(added).toHaveLength(1);
    expect(added[0].item.name).toBe("Read");
    expect(added[0].item.call_id).toMatch(/^call_0_\d+$/);

    const argsDone = responsesEvents(out, "response.function_call_arguments.done");
    expect(argsDone).toHaveLength(1);
    expect(argsDone[0].arguments).toBe('{"file_path":"/x"}');

    const completed = responsesEvents(out, "response.completed");
    expect(completed).toHaveLength(1);
    const items = completed[0].response.output.filter((item) => item.type === "function_call");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "function_call",
      call_id: added[0].item.call_id,
      name: "Read",
      arguments: '{"file_path":"/x"}',
    });
  });
});
