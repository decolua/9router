import { describe, expect, it } from "vitest";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Drive createPassthroughStreamWithLogger with a claude SSE stream containing an
// AskUserQuestion tool_use (options>4, questions-as-string). Assert emitted
// stream has options capped to 4 and questions coerced to array.
// RED today: passthrough has no tool_use arg sanitizer.

async function runPassthroughStream(input) {
  const stream = createPassthroughStreamWithLogger(null, null, null, null, null, null, null, FORMATS.CLAUDE);
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

function buildAskUserQuestionSSE(argsObj) {
  const lines = [
    'event: message_start',
    `data: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "test", stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } } })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "AskUserQuestion", input: {} } })}`,
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
  return lines.join('\n');
}

describe("Claude identity passthrough: AskUserQuestion arg sanitization", () => {
  it("caps options to maxItems:4 and coerces questions from JSON string to array", async () => {
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

    // questions emitted as JSON string (the P2 bug), options has 5 items (the P1 bug)
    const argsObj = { questions: JSON.stringify(questions) };

    const input = buildAskUserQuestionSSE(argsObj);
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
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("preserves valid AskUserQuestion (options<=4, questions as array)", async () => {
    const argsObj = {
      questions: [
        {
          question: "Which?",
          options: [
            { label: "A", value: "a" },
            { label: "B", value: "b" },
          ],
        },
      ],
    };

    const input = buildAskUserQuestionSSE(argsObj);
    const output = await runPassthroughStream(input);
    const events = parseClaudeSSEEvents(output);

    const deltaEvents = events.filter(
      (e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta"
    );
    expect(deltaEvents.length).toBe(1);

    const sanitizedArgs = JSON.parse(deltaEvents[0].delta.partial_json);
    expect(Array.isArray(sanitizedArgs.questions)).toBe(true);
    expect(sanitizedArgs.questions[0].options.length).toBe(2);
  });

  it("handles multi-fragment input_json_delta", async () => {
    const questions = [
      {
        question: "Pick one",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
          { label: "C", value: "c" },
          { label: "D", value: "d" },
          { label: "E", value: "e" },
          { label: "F", value: "f" },
        ],
      },
    ];
    const argsObj = { questions: JSON.stringify(questions) };
    const argsJson = JSON.stringify(argsObj);
    const mid = Math.floor(argsJson.length / 2);

    const lines = [
      'event: content_block_start',
      `data: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_2", name: "AskUserQuestion", input: {} } })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argsJson.slice(0, mid) } })}`,
      '',
      'event: content_block_delta',
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: argsJson.slice(mid) } })}`,
      '',
      'event: content_block_stop',
      `data: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
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
  });
});