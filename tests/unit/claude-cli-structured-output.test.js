import { describe, it, expect } from "vitest";
import {
  buildClaudeCliArgs,
  createClaudeCliContext,
  planClaudeCliInvocation,
  translateClaudeCliEvent,
} from "open-sse/executors/claude-cli.js";
import { parseSSEToOpenAIResponse } from "open-sse/handlers/chatCore/sseToJsonHandler.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

/**
 * `response_format` used to be refused outright on the premise that the CLI has
 * no structured-output mode. It has one: `claude -p --json-schema <schema>`.
 * Measured on 2.1.285 with the flags this provider always passes
 * (`--max-turns 1 --tools ""`), the answer does not arrive as text. The model
 * calls an internal tool, `StructuredOutput`, whose input is the validated
 * answer, and the `result` event carries it again as `structured_output`:
 *
 *   thinking → tool_use StructuredOutput → tool_result → result
 *     result:            "{\"answer\":4}"
 *     structured_output: { answer: 4 }
 *     stop_reason:       "tool_use" on the turn, is_error: false
 *
 * Read as an ordinary turn, that is a tool call to a tool the client never
 * declared, a finish reason of "tool_calls", and — because something was
 * "sent" — no fallback to the result text. The client gets no JSON at all.
 */

const parsed = (frames) => frames
  .map((f) => { try { return JSON.parse(f.replace(/^data: /, "").trim()); } catch { return null; } })
  .filter(Boolean);

const structuredCtx = () => createClaudeCliContext({
  id: "chatcmpl-x", created: 1, model: "m", structured: true,
});

const stream = (inner) => ({ type: "stream_event", event: inner });

// The order the real binary emits, from a captured run.
const STRUCTURED_TURN = [
  stream({ type: "message_start", message: { usage: { input_tokens: 10 } } }),
  stream({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
  stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "2+2" } }),
  { type: "assistant", message: { content: [{ type: "thinking", thinking: "2+2" }], stop_reason: null } },
  stream({ type: "content_block_stop", index: 0 }),
  stream({
    type: "content_block_start",
    index: 1,
    content_block: { type: "tool_use", id: "toolu_1", name: "StructuredOutput", input: {} },
  }),
  stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "" } }),
  stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"answer\"" } }),
  stream({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: ":4}" } }),
  {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "toolu_1", name: "StructuredOutput", input: { answer: 4 } }],
      stop_reason: null,
    },
  },
  stream({ type: "content_block_stop", index: 1 }),
  stream({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 143 } }),
  stream({ type: "message_stop" }),
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] } },
];

const RESULT_OK = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 2,
  stop_reason: "tool_use",
  terminal_reason: "completed",
  result: "{\"answer\":4}",
  structured_output: { answer: 4 },
};

const run = (events, ctx = structuredCtx()) => ({
  ctx,
  out: events.flatMap((event) => parsed(translateClaudeCliEvent(event, ctx).frames)),
});

const contentOf = (out) => out
  .map((e) => e.choices?.[0]?.delta?.content)
  .filter((c) => typeof c === "string");

describe("a turn that answers through --json-schema", () => {
  it("delivers the validated output as the message content, exactly once", () => {
    const { out } = run([...STRUCTURED_TURN, RESULT_OK]);
    expect(out.some((e) => e.error)).toBe(false);
    expect(contentOf(out)).toEqual(["{\"answer\":4}"]);
  });

  it("does not hand the client a tool call for the CLI's own answer channel", () => {
    const { out } = run([...STRUCTURED_TURN, RESULT_OK]);
    const calls = out.flatMap((e) => e.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toEqual([]);
  });

  it("finishes with stop, not tool_calls, although the turn ended on a tool_use", () => {
    const { out } = run([...STRUCTURED_TURN, RESULT_OK]);
    expect(out.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("leaves out whatever text the model writes around the call", () => {
    // A preamble is not JSON, and the caller asked for JSON and nothing else.
    const events = [
      stream({ type: "message_start", message: {} }),
      stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sure, here it is:" } }),
      { type: "assistant", message: { content: [{ type: "text", text: "Sure, here it is:" }], stop_reason: null } },
      ...STRUCTURED_TURN.slice(5),
      RESULT_OK,
    ];
    const { out } = run(events);
    expect(contentOf(out)).toEqual(["{\"answer\":4}"]);
  });

  it("keeps the model's reasoning, which is not part of the answer", () => {
    const { out } = run([...STRUCTURED_TURN, RESULT_OK]);
    const reasoning = out.map((e) => e.choices?.[0]?.delta?.reasoning_content).filter(Boolean);
    expect(reasoning).toEqual(["2+2"]);
  });

  it("carries the usage the turn reported", () => {
    const { out } = run([...STRUCTURED_TURN, { ...RESULT_OK, usage: { input_tokens: 10, output_tokens: 143 } }]);
    expect(out.at(-1).usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 143 });
  });

  it("finishes with stop when the output arrives without a streamed StructuredOutput call", () => {
    // Nothing set the gate that the streamed form does; the delivered output is
    // complete by definition, so the finish reason is decided where it is delivered.
    const { out } = run([RESULT_OK]);
    expect(contentOf(out)).toEqual(["{\"answer\":4}"]);
    expect(out.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("finishes with stop, not length, when a ceiling flagged a turn that did deliver its output", () => {
    // The CLI marks a turn its output ceiling touched as an error, content and
    // all. A validated structured_output is whole, so "length" would make a
    // client such as openai-python's parse() reject a correct answer.
    const ctx = createClaudeCliContext({
      id: "chatcmpl-x", created: 1, model: "m", structured: true, tokenCeiling: true,
    });
    const { out } = run([
      ...STRUCTURED_TURN,
      { ...RESULT_OK, is_error: true, stop_reason: "stop_sequence" },
    ], ctx);
    expect(contentOf(out)).toEqual(["{\"answer\":4}"]);
    expect(out.at(-1).choices[0].finish_reason).toBe("stop");
  });
});

describe("a structured turn that did not produce the output", () => {
  it("is an error, not prose passed off as the JSON that was asked for", () => {
    const events = [
      stream({ type: "message_start", message: {} }),
      stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I can't do that." } }),
      stream({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      { type: "result", subtype: "success", is_error: false, num_turns: 1, result: "I can't do that." },
    ];
    const { out } = run(events);
    expect(out[0].error?.code).toBe("structured_output_missing");
    expect(contentOf(out).join("")).not.toMatch(/^I can't do that\.$/m);
  });

  it("says why when a token ceiling cut the output short", () => {
    const ctx = createClaudeCliContext({
      id: "chatcmpl-x", created: 1, model: "m", structured: true, tokenCeiling: true,
    });
    const events = [
      ...STRUCTURED_TURN.slice(0, 7),
      {
        type: "result",
        subtype: "success",
        is_error: true,
        stop_reason: "stop_sequence",
        num_turns: 1,
        result: "API Error: The model's response exceeded the 64 output token maximum.",
      },
    ];
    const { out } = run(events, ctx);
    // Not out[0]: the thinking that came first has already gone out as reasoning.
    const failure = out.find((e) => e.error);
    expect(failure?.error.code).toBe("structured_output_missing");
    expect(failure.error.message).toMatch(/max_tokens/);
  });

  it("is an error when the CLI itself gave up", () => {
    // stop_reason "tool_use" is what the real binary sends here. Without the
    // structured gating that — plus a tool call for StructuredOutput — reads as
    // a proposed call, and the turn would not be an error at all.
    const { out } = run([
      ...STRUCTURED_TURN.slice(0, 7),
      { type: "result", subtype: "error_max_turns", is_error: true, stop_reason: "tool_use", num_turns: 2 },
    ]);
    const failure = out.find((e) => e.error);
    expect(failure?.error.code).toBe("error_max_turns");
    expect(contentOf(out).join("")).not.toContain("{\"answer\"");
  });

  it("does not take JSON-looking result text for the answer when the field is absent", () => {
    // Only structured_output has been through the CLI's validation. Result text
    // that happens to parse has not, and this request exists to be validated.
    const { structured_output, ...withoutField } = RESULT_OK;
    const { out } = run([...STRUCTURED_TURN, withoutField]);
    expect(out.find((e) => e.error)?.error.code).toBe("structured_output_missing");
    expect(contentOf(out).join("")).not.toContain("{\"answer\":4}");
  });

  it("does not take JSON the model wrote as plain text, without calling the tool", () => {
    const events = [
      stream({ type: "message_start", message: {} }),
      stream({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{\"answer\":5}" } }),
      stream({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      { type: "result", subtype: "success", is_error: false, num_turns: 1, result: "{\"answer\":5}" },
    ];
    const { out } = run(events);
    expect(out.find((e) => e.error)?.error.code).toBe("structured_output_missing");
    expect(contentOf(out).join("")).not.toContain("{\"answer\":5}");
  });
});

describe("a structured failure is the request's, not the account's", () => {
  // A choice-less error frame with no status reaches a non-streaming client as a
  // 502, which the account loop answers by locking the model on that account for
  // 30 seconds and failing over — for a request whose own schema or prompt was
  // the problem. Before structured output existed this request got a 400 before
  // anything spawned, and a 400 never locks.
  const failureOf = (events, ctx) => run(events, ctx).out.find((e) => e.error)?.error;

  it("carries a 4xx status on structured_output_missing", () => {
    const error = failureOf([...STRUCTURED_TURN, (({ structured_output, ...r }) => r)(RESULT_OK)]);
    expect(error.code).toBe("structured_output_missing");
    expect(error.status).toBe(422);
  });

  it("carries it when the CLI gave up validating", () => {
    for (const subtype of ["error_max_structured_output_retries", "error_max_turns"]) {
      const error = failureOf([
        ...STRUCTURED_TURN.slice(0, 7),
        { type: "result", subtype, is_error: true, stop_reason: "tool_use", num_turns: 2 },
      ]);
      expect(error.code, subtype).toBe(subtype);
      expect(error.status, subtype).toBe(422);
    }
  });

  it("leaves every other failure of a structured turn as it was", () => {
    // Not the request's fault: the account loop must still see these as it does today.
    const error = failureOf([
      ...STRUCTURED_TURN.slice(0, 7),
      { type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1, errors: ["boom"] },
    ]);
    expect(error.code).toBe("error_during_execution");
    expect(error.status).toBeUndefined();
  });

  it("adds no status to a failure of an ordinary turn", () => {
    const ctx = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" });
    const error = failureOf([{ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 2 }], ctx);
    expect(error.code).toBe("error_max_turns");
    expect(error.status).toBeUndefined();
  });

  it("reaches a non-streaming client with that status, and the account loop does not lock for it", () => {
    const ctx = structuredCtx();
    const sse = [...STRUCTURED_TURN.slice(0, 7), {
      type: "result", subtype: "error_max_structured_output_retries", is_error: true, stop_reason: "tool_use", num_turns: 2,
    }].flatMap((event) => translateClaudeCliEvent(event, ctx).frames).join("");
    const folded = parseSSEToOpenAIResponse(sse, "m");
    expect(folded.error.status).toBe(422);
    expect(checkFallbackError(422, folded.error.message)).toMatchObject({ shouldFallback: false, cooldownMs: 0 });
  });
});

describe("a turn that did not ask for structured output", () => {
  it("still hands a tool call named StructuredOutput to the client", () => {
    // The swallowing is tied to the request, not to the name: a plain request
    // has no such channel, so a call by that name is the client's own.
    const ctx = createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" });
    const frames = translateClaudeCliEvent(stream({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_9", name: "StructuredOutput", input: {} },
    }), ctx).frames;
    const calls = parsed(frames).flatMap((e) => e.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("StructuredOutput");
  });
});

describe("the flag reaches the CLI", () => {
  const SCHEMA = "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"number\"}}}";

  it("is passed as one argv element, next to its value", () => {
    const args = buildClaudeCliArgs({ model: "haiku", jsonSchema: SCHEMA });
    const at = args.indexOf("--json-schema");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe(SCHEMA);
  });

  it("is absent when none was asked for, so an ordinary request spawns what it always did", () => {
    expect(buildClaudeCliArgs({ model: "haiku" })).not.toContain("--json-schema");
    expect(buildClaudeCliArgs({ model: "haiku", jsonSchema: "" })).not.toContain("--json-schema");
  });

  it("goes through the invocation plan", () => {
    const plan = planClaudeCliInvocation({
      model: "haiku",
      messages: [{ role: "user", content: "2+2?" }],
      jsonSchema: SCHEMA,
    });
    expect(plan.args[plan.args.indexOf("--json-schema") + 1]).toBe(SCHEMA);
  });

  it("keeps the one-turn limit and the empty tool set it was measured under", () => {
    // 2.1.285: structured output completed under exactly these flags.
    const args = buildClaudeCliArgs({ model: "haiku", jsonSchema: SCHEMA });
    expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
    expect(args[args.indexOf("--tools") + 1]).toBe("");
  });
});

describe("a failed turn the CLI says was rate limited (api_error_status 429)", () => {
  // Whatever the CLI's wording, a 429 it reports should reach the account loop as a
  // 429 (exponential backoff), not as an unmarked failure (a 502: retried every 30 s).
  const ctx = () => createClaudeCliContext({ id: "chatcmpl-x", created: 1, model: "m" });

  it("carries status 429 on the error frame", () => {
    const { out } = run([{ type: "result", subtype: "success", is_error: true, api_error_status: 429, num_turns: 1, result: "Request rejected (429)" }], ctx());
    expect(out.find((e) => e.error)?.error.status).toBe(429);
  });

  it("leaves other upstream failures as they were", () => {
    const { out } = run([{ type: "result", subtype: "success", is_error: true, api_error_status: 529, num_turns: 1, result: "Overloaded" }], ctx());
    expect(out.find((e) => e.error)?.error.status).toBeUndefined();
  });
});
