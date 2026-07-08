import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// TDD for narrowing the claude passthrough sanitizer to tool_use only.
// Pre-P1/P2: non-tool-use claude chunks emitted raw (byte-for-byte, line + "\n").
// P1/P2 regression: sanitizer at stream.js:194-226 re-serialized every claude chunk
//   as `event: ${type}\ndata: ${JSON.stringify(parsed)}\n\n` and `continue`d,
//   bypassing the raw-line path. Since the `event:` line is emitted raw
//   separately (it doesn't start with `data:`), every event became
//   `event: X\nevent: X\ndata: {...}\n\n\n` — duplicate event: line + extra
//   blank-line event separator. Under `disconnect: ResponseAborted` the
//   client's SSE parser hits an empty/partial event → JSON.parse("") →
//   "JSON Parse error: Unexpected EOF".
// Fix: sanitizer only intercepts tool_use; non-tool-use chunks emit raw.

async function runPassthroughStream(input) {
  const stream = createPassthroughStreamWithLogger(
    null, null, null, null, null, null, null, FORMATS.CLAUDE
  );
  const writer = stream.writable.getWriter();
  const chunks = [];
  const writable = new WritableStream({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
  });
  const pipePromise = stream.readable.pipeTo(writable);
  await writer.write(new TextEncoder().encode(input));
  await writer.close();
  await pipePromise;
  return chunks.join("");
}

function buildClaudeTextStream() {
  const lines = [
    'event: message_start',
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "test", stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } })}`,
    '',
    'event: content_block_stop',
    `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } })}`,
    '',
    'event: message_stop',
    `data: ${JSON.stringify({ type: "message_stop" })}`,
    '',
    '',
  ];
  return lines.join('\n');
}

function buildClaudeThinkingStream() {
  const lines = [
    'event: message_start',
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", content: [], model: "test", stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } })}`,
    '',
    'event: content_block_stop',
    `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } })}`,
    '',
    'event: content_block_stop',
    `data: ${JSON.stringify({ type: "content_block_stop", index: 1 })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } })}`,
    '',
    'event: message_stop',
    `data: ${JSON.stringify({ type: "message_stop" })}`,
    '',
    '',
  ];
  return lines.join('\n');
}

describe("Claude passthrough sanitizer narrowing (raw emission for non-tool-use)", () => {
  it("emits non-tool-use text claude chunks as raw lines (byte-for-byte, no re-serialization)", async () => {
    const input = buildClaudeTextStream();
    const output = await runPassthroughStream(input);

    // Strip the trailing "data: [DONE]\n\n" appended by flush — we only care
    // about the non-tool-use event emission here.
    const doneIdx = output.indexOf("data: [DONE]");
    const core = doneIdx >= 0 ? output.slice(0, doneIdx) : output;

    // Pre-P1/P2 behavior: non-tool-use chunks emit raw lines (line + "\n").
    // Output must be byte-for-byte equal to the input. P1/P2 regression added
    // duplicate `event:` lines + extra blank-line separators via re-serialization.
    expect(core).toBe(input);
  });

  it("emits non-tool-use thinking+text claude chunks as raw lines (byte-for-byte)", async () => {
    const input = buildClaudeThinkingStream();
    const output = await runPassthroughStream(input);

    const doneIdx = output.indexOf("data: [DONE]");
    const core = doneIdx >= 0 ? output.slice(0, doneIdx) : output;

    expect(core).toBe(input);
  });

  it("does not emit duplicate `event:` lines for a single claude event", async () => {
    const input = buildClaudeTextStream();
    const output = await runPassthroughStream(input);

    // Count `event: message_start` occurrences — should be exactly 1 per event
    // (raw line). P1/P2 regression produced 2 (raw + re-serialized).
    const messageStartMatches = output.match(/^event: message_start$/gm) || [];
    expect(messageStartMatches.length).toBe(1);

    const textDeltaMatches = output.match(/^event: content_block_delta$/gm) || [];
    expect(textDeltaMatches.length).toBe(1);
  });

  it("does not emit extra blank-line event separators (no empty events between real events)", async () => {
    const input = buildClaudeTextStream();
    const output = await runPassthroughStream(input);

    // Pre-P1/P2: events separated by exactly one blank line (\n\n between event blocks).
    // P1/P2 regression: \n\n\n (extra blank line) → empty SSE event → client JSON.parse("") → EOF.
    // Assert NO occurrence of three consecutive newlines in the core output.
    const doneIdx = output.indexOf("data: [DONE]");
    const core = doneIdx >= 0 ? output.slice(0, doneIdx) : output;

    expect(core).not.toContain("\n\n\n");
  });

  it("tolerates a truncated final event (simulated ResponseAborted mid-JSON) by flushing the partial line raw", async () => {
    // Complete text stream + a partial truncated data line (no trailing \n)
    // simulating the upstream aborting mid-event. The partial line stays in
    // the stream buffer until flush, which emits it raw — pre-P1/P2 behavior.
    const complete = buildClaudeTextStream();
    const truncated = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial';
    const input = complete + truncated;

    const output = await runPassthroughStream(input);
    const doneIdx = output.indexOf("data: [DONE]");
    const core = doneIdx >= 0 ? output.slice(0, doneIdx) : output;

    // The complete portion should pass through raw (byte-for-byte).
    expect(core.startsWith(complete)).toBe(true);
    // The truncated tail should be flushed raw (partial JSON, as-is) — NOT
    // re-serialized into a complete JSON object that contradicts the abort.
    const tail = core.slice(complete.length);
    expect(tail).toContain('"text":"partial');
    // Crucially, no re-serialized `event: content_block_delta\ndata: {...}\n\n`
    // was synthesized for the truncated event (which would have produced
    // complete JSON that contradicts the abort).
    // The raw `event: content_block_delta\n` line is emitted (it's a complete
    // line), but no data: line follows it — matching pre-P1/P2 behavior.
    expect(tail).not.toMatch(/event: content_block_delta\ndata: \{[^}]*partial[^}]*\}\n\n/);
  });
});

describe("Claude passthrough sanitizer: tool_use sanitization still preserved", () => {
  // Verifies the narrowing fix does not regress the P1/P2 tool_use arg sanitizer.

  function parseClaudeSSEEvents(output) {
    const events = [];
    const blocks = output.split("\n\n");
    for (const block of blocks) {
      const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        const data = dataLine.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            events.push(JSON.parse(data));
          } catch {
            // skip non-JSON
          }
        }
      }
    }
    return events;
  }

  it("still caps AskUserQuestion options to 4 and coerces questions from string to array", async () => {
    const questions = [
      {
        question: "Which option?",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
          { label: "C", value: "c" },
          { label: "D", value: "d" },
          { label: "E", value: "e" },
        ],
      },
    ];
    const argsObj = { questions: JSON.stringify(questions) };

    const lines = [
      'event: message_start',
      `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_3", type: "message", role: "assistant", content: [], model: "test", stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })}`,
      '',
      'event: content_block_start',
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_3", name: "AskUserQuestion", input: {} } })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(argsObj) } })}`,
      '',
      'event: content_block_stop',
      `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
      '',
      'event: message_delta',
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 10 } })}`,
      '',
      'event: message_stop',
      `data: ${JSON.stringify({ type: "message_stop" })}`,
      '',
      '',
    ];
    const input = lines.join('\n');

    const output = await runPassthroughStream(input);
    const events = parseClaudeSSEEvents(output);

    const deltaEvents = events.filter(
      (e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta"
    );
    expect(deltaEvents.length).toBe(1);

    const sanitizedArgs = JSON.parse(deltaEvents[0].delta.partial_json);
    expect(Array.isArray(sanitizedArgs.questions)).toBe(true);
    expect(sanitizedArgs.questions[0].options.length).toBe(4);
    expect(sanitizedArgs.questions[0].options.map((o) => o.value)).toEqual([
      "a", "b", "c", "d",
    ]);
  });
});