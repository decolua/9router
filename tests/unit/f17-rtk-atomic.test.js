// F17 / T1.2 M8 — rtk compressed tool_result content strictly in-place: a throw
// mid-loop (autoDetect/filter/getter on a later message) returned null while the
// ALREADY-compressed earlier blocks stayed mutilated, and the log (formatRtkLog
// via chatCore) reported "nothing done" — violating the documented fail-open
// contract "any error returns null and leaves the body untouched".
// Fix contract: failure mid-loop ⇒ original body byte-identical; success ⇒ same
// compression + stats as before (is_error/status:"error" still skipped).
import { describe, it, expect } from "vitest";
import { compressMessages, formatRtkLog } from "../../open-sse/rtk/index.js";

// Grep-shaped output: autoDetectFilter compresses it (pattern proven in rtk.test.js).
function makeGrepOutput(n = 40) {
  const lines = [];
  for (let i = 1; i <= n; i++) {
    lines.push(`src/foo.js:${i}:const x${i} = "some value here with padding text padding text"`);
  }
  return lines.join("\n");
}

describe("rtk fail-open atomicity (M8)", () => {
  it("mid-loop failure on messages path leaves the already-processed message untouched and returns null", () => {
    const LONG = makeGrepOutput();
    const boom = new Error("simulated mid-loop failure");
    const body = {
      messages: [
        { role: "tool", tool_call_id: "t1", content: LONG },
        // Accessing .content throws: today this happens AFTER t1 is compressed in place.
        { role: "tool", tool_call_id: "t2", get content() { throw boom; } },
      ],
    };

    const stats = compressMessages(body, true);

    expect(stats).toBeNull();
    // The contract: nothing was written — t1 still holds its ORIGINAL bytes.
    expect(body.messages[0].content).toBe(LONG);
    // t2 is still the throwing getter (the object was never replaced/cloned over).
    const desc = Object.getOwnPropertyDescriptor(body.messages[1], "content");
    expect(typeof desc.get).toBe("function");
    expect(() => body.messages[1].content).toThrow("simulated mid-loop failure");
  });

  it("mid-loop failure on the kiro path leaves the body untouched and returns null", () => {
    const LONG = makeGrepOutput();
    const boom = new Error("simulated kiro mid-loop failure");
    const body = {
      conversationState: {
        history: [
          { userInputMessage: { userInputMessageContext: { toolResults: [
            { status: "success", content: [{ text: LONG }] },
          ] } } },
          { get userInputMessage() { throw boom; } },
        ],
      },
    };

    const stats = compressMessages(body, true);

    expect(stats).toBeNull();
    const tr = body.conversationState.history[0]
      .userInputMessage.userInputMessageContext.toolResults[0];
    expect(tr.content[0].text).toBe(LONG);
    const desc = Object.getOwnPropertyDescriptor(body.conversationState.history[1], "userInputMessage");
    expect(typeof desc.get).toBe("function");
  });

  it("success path compresses like before, returns stats, keeps is_error results intact", () => {
    const LONG = makeGrepOutput();
    const body = {
      messages: [
        { role: "tool", tool_call_id: "t1", content: LONG },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t2", content: LONG },
            // skipped to preserve error traces — must never be compressed
            { type: "tool_result", tool_use_id: "t3", is_error: true, content: LONG },
          ],
        },
      ],
    };

    const stats = compressMessages(body, true);

    expect(stats).toBeTruthy();
    expect(stats.hits.length).toBe(2);
    expect(stats.bytesAfter).toBeLessThan(stats.bytesBefore);
    expect(body.messages[0].content).not.toBe(LONG);
    expect(body.messages[0].content.length).toBeLessThan(LONG.length);
    expect(body.messages[1].content[0].text ?? body.messages[1].content[0].content)
      .not.toBe(LONG);
    // is_error block untouched (skip must survive the refactor)
    expect(body.messages[1].content[1].content).toBe(LONG);
    expect(formatRtkLog(stats)).toContain("[RTK] saved");
  });

  it("success path covers the OpenAI Responses input shape", () => {
    const LONG = makeGrepOutput();
    const body = {
      input: [
        { type: "function_call_output", call_id: "c1", output: LONG },
      ],
    };

    const stats = compressMessages(body, true);

    expect(stats).toBeTruthy();
    expect(stats.hits.length).toBe(1);
    expect(body.input[0].output).not.toBe(LONG);
  });

  it("disabled or empty bodies short-circuit with null", () => {
    expect(compressMessages({ messages: [] }, false)).toBeNull();
    expect(compressMessages(null, true)).toBeNull();
    expect(compressMessages({ messages: "not-an-array" }, true)).toBeNull();
  });
});
