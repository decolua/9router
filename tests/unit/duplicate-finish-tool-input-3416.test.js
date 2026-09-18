/**
 * A repeated `finish_reason` duplicated the whole terminal set, tool input
 * included.
 *
 * The OpenAI→Claude response translator buffers `tool_calls.function.arguments`
 * and emits them as ONE `input_json_delta` when `finish_reason` arrives. The
 * finish branch had no once-guard, so a provider that repeats `finish_reason` on
 * a trailing usage chunk — a common gateway shape — emitted the complete
 * arguments a second time. A Claude client concatenates the two deltas:
 *
 *     {"command":"ls -la"}{"command":"ls -la"}
 *
 * which is not parseable JSON, and produces
 * `InputValidationError: … could not be parsed as JSON` — the symptom reported in
 * #3416. That report's payload was the same size as the command itself, so this
 * duplication is probably NOT what that reporter hit; it is a separate defect on
 * the same path, found while investigating it.
 *
 * Measured on master with the sequence below: the terminal set
 * (input_json_delta, content_block_stop, message_delta, message_stop) was emitted
 * twice; a plain text response was closed twice as well.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";
import { initState, initTranslators, translateResponse } from "open-sse/translator/index.js";

const ARGS_PART_1 = '{"command":"cd /tmp && ls -la | grep -iE ';
const ARGS_PART_2 = '\'a|b\' ; echo \\"---\\""}';

function chunk(extra) {
  return { id: "chatcmpl-1", model: "gpt-x", choices: [{ index: 0, delta: {}, ...extra }] };
}

function toolChunk(fields) {
  return chunk({ delta: { tool_calls: [{ index: 0, ...fields }] } });
}

function run(chunks) {
  const state = initState(FORMATS.CLAUDE);
  const events = [];
  for (const c of chunks) {
    const out = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, c, state);
    if (out?.length) events.push(...out);
  }
  const flushed = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, null, state);
  if (flushed?.length) events.push(...flushed);
  return events;
}

const STREAM = [
  toolChunk({ id: "call_1", function: { name: "Bash", arguments: ARGS_PART_1 } }),
  toolChunk({ function: { arguments: ARGS_PART_2 } }),
  chunk({ finish_reason: "tool_calls" }),
];

/** The trailing usage chunk that repeats finish_reason. */
const REPEATED_FINISH = {
  id: "chatcmpl-1",
  model: "gpt-x",
  choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  usage: { prompt_tokens: 5, completion_tokens: 7 },
};

const typesOf = (events, type) => events.filter((e) => e.type === type);

describe("repeated finish_reason must not duplicate the tool input (refs #3416)", () => {
  beforeAll(async () => { await initTranslators(); });

  it("emits the tool input exactly once for a well-behaved stream", () => {
    const events = run(STREAM);
    const deltas = typesOf(events, "content_block_delta").filter(
      (e) => e.delta?.type === "input_json_delta",
    );

    expect(deltas).toHaveLength(1);
    expect(deltas[0].delta.partial_json).toBe(ARGS_PART_1 + ARGS_PART_2);
    expect(JSON.parse(deltas[0].delta.partial_json).command).toContain("grep");
  });

  it("emits the tool input exactly once when finish_reason repeats", () => {
    const events = run([...STREAM, REPEATED_FINISH]);
    const deltas = typesOf(events, "content_block_delta").filter(
      (e) => e.delta?.type === "input_json_delta",
    );

    expect(deltas).toHaveLength(1);
    // The concatenation the client would otherwise receive is not valid JSON.
    const asClientSees = deltas.map((d) => d.delta.partial_json).join("");
    expect(() => JSON.parse(asClientSees)).not.toThrow();
  });

  it("closes the message exactly once when finish_reason repeats", () => {
    const events = run([...STREAM, REPEATED_FINISH]);

    expect(typesOf(events, "content_block_stop")).toHaveLength(1);
    expect(typesOf(events, "message_delta")).toHaveLength(1);
    expect(typesOf(events, "message_stop")).toHaveLength(1);
  });

  it("still closes a plain text response exactly once", () => {
    const events = run([
      chunk({ delta: { content: "hello" } }),
      chunk({ finish_reason: "stop" }),
      { id: "chatcmpl-1", model: "gpt-x", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);

    expect(typesOf(events, "message_stop")).toHaveLength(1);
    expect(typesOf(events, "content_block_stop")).toHaveLength(1);
    expect(typesOf(events, "content_block_delta")).toHaveLength(1);
  });
});
