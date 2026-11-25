import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger } from "open-sse/utils/stream.js";

/**
 * What the dashboard records for a turn whose whole answer was a tool call.
 *
 * The accumulator collected `delta.content` and `delta.reasoning_content` and
 * nothing else, so a tool-call-only turn finished with an empty string — and
 * the recorder writes "[Empty streaming response]" for an empty string. That is
 * the single most common shape an agentic client produces: it reached the
 * client correctly every time, and the record said nothing came back. Anyone
 * reading the tab saw a provider returning empty responses over and over.
 */

const encoder = new TextEncoder();

/** Push these SSE frames through the transform and return what it reported. */
async function record(frames) {
  let reported = null;
  const stream = createPassthroughStreamWithLogger(
    "claude-cli",
    null,
    "claude-cli-opus-1m",
    null,
    { messages: [{ role: "user", content: "go" }] },
    (contentObj, usage) => { reported = { contentObj, usage }; },
    null,
  );

  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const drained = (async () => {
    // The transform only finalizes once the stream is read to the end.
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  })();
  for (const frame of frames) await writer.write(encoder.encode(frame));
  await writer.close();
  await drained;
  return reported;
}

const sse = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
const DONE = "data: [DONE]\n\n";

describe("what a tool-call-only turn records", () => {
  it("names the call, instead of leaving the record empty", async () => {
    const reported = await record([
      sse({
        id: "chatcmpl-1", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{
          index: 0, id: "call_1", type: "function",
          function: { name: "terminal", arguments: "" },
        }] } }],
      }),
      sse({
        id: "chatcmpl-1", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{
          index: 0, function: { arguments: '{"cmd":' },
        }] } }],
      }),
      sse({
        id: "chatcmpl-1", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{
          index: 0, function: { arguments: '"ls"}' },
        }] } }],
      }),
      sse({
        id: "chatcmpl-1", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      DONE,
    ]);

    expect(reported).not.toBeNull();
    // Not "" — an empty string is what the recorder turns into
    // "[Empty streaming response]".
    expect(reported.contentObj.content).toBeTruthy();
    expect(reported.contentObj.content).toContain("terminal");
    expect(reported.contentObj.content).toContain('{"cmd":"ls"}');
  });

  it("keeps the answer when a turn both spoke and called a tool", async () => {
    // Text is the better record of what happened; the call is only a stand-in
    // for when there is none.
    const reported = await record([
      sse({
        id: "chatcmpl-2", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { role: "assistant", content: "Checking that now." } }],
      }),
      sse({
        id: "chatcmpl-2", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{
          index: 0, id: "call_1", type: "function",
          function: { name: "terminal", arguments: "{}" },
        }] } }],
      }),
      sse({
        id: "chatcmpl-2", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      DONE,
    ]);

    expect(reported.contentObj.content).toBe("Checking that now.");
  });

  it("records several calls in one turn, not just the first", async () => {
    const reported = await record([
      sse({
        id: "chatcmpl-3", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { role: "assistant", tool_calls: [
          { index: 0, id: "a", type: "function", function: { name: "read_file", arguments: "{}" } },
          { index: 1, id: "b", type: "function", function: { name: "terminal", arguments: "{}" } },
        ] } }],
      }),
      sse({
        id: "chatcmpl-3", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      DONE,
    ]);

    expect(reported.contentObj.content).toContain("read_file");
    expect(reported.contentObj.content).toContain("terminal");
  });

  it("still records nothing for a turn that truly produced nothing", async () => {
    // The placeholder is right in that case — it is only wrong when a call was
    // made and went unrecorded.
    const reported = await record([
      sse({
        id: "chatcmpl-4", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { role: "assistant" } }],
      }),
      sse({
        id: "chatcmpl-4", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      DONE,
    ]);

    expect(reported.contentObj.content).toBe("");
  });
});
