// Audit item: a partially answered parallel tool batch ([call_A, call_B] with a
// tool reply for call_A only) must be repaired for OpenAI-shaped targets.
// concerns/toolCall.js fixMissingToolResponses triggers on ANY id of the batch
// (hasToolResults), so the OpenAI chat body kept call_B unanswered and
// OpenAI-compatible upstreams reject an assistant tool_calls turn with an
// unanswered id. The Claude leg already repairs it (formats/claude.js).
import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { SYNTHETIC_TOOL_RESULT_TEXT } from "../../open-sse/translator/formats/claude.js";

const clone = (v) => structuredClone(v);

const call = (id, name = "Read") => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});

function assistantWithCalls(ids) {
  return { role: "assistant", content: null, tool_calls: ids.map((id) => call(id)) };
}

function toolResult(id, content) {
  return { role: "tool", tool_call_id: id, content };
}

function partialBody() {
  return {
    model: "gpt-x",
    messages: [
      { role: "user", content: "two lookups" },
      assistantWithCalls(["call_A", "call_B"]),
      toolResult("call_A", "result A"),
      { role: "user", content: "continue" },
    ],
  };
}

function completeBody() {
  return {
    model: "gpt-x",
    messages: [
      { role: "user", content: "two lookups" },
      assistantWithCalls(["call_A", "call_B"]),
      toolResult("call_A", "result A"),
      toolResult("call_B", "result B"),
      { role: "user", content: "continue" },
    ],
  };
}

function unansweredBody() {
  return {
    model: "gpt-x",
    messages: [
      { role: "user", content: "two lookups" },
      assistantWithCalls(["call_A", "call_B"]),
      { role: "user", content: "forget it" },
    ],
  };
}

const toOpenAI = (body) =>
  translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-x", clone(body), true, null, "openai");

// The tool messages OpenAI requires to immediately follow an assistant
// tool_calls turn (before the next non-tool message).
function toolRunAfter(messages, assistantIndex) {
  const run = [];
  for (let i = assistantIndex + 1; i < messages.length; i++) {
    if (messages[i].role !== "tool") break;
    run.push(messages[i]);
  }
  return run;
}

function assistantIndex(messages) {
  const i = messages.findIndex((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe("partial parallel tool batch against an OpenAI target", () => {
  it("inserts a placeholder reply for the unanswered call id (audit repro)", () => {
    const out = toOpenAI(partialBody());
    const idx = assistantIndex(out.messages);
    const run = toolRunAfter(out.messages, idx);

    expect(run.map((m) => m.tool_call_id)).toEqual(["call_A", "call_B"]);
    expect(run[0].content).toBe("result A");
    expect(run[1].content).toBe(SYNTHETIC_TOOL_RESULT_TEXT);
    // The placeholder must stay inside the assistant turn's tool run: the next
    // message after it is the user turn, not another assistant/tool message.
    expect(out.messages[idx + 1 + run.length].role).toBe("user");
  });

  it("leaves a fully answered parallel batch untouched", () => {
    const out = toOpenAI(completeBody());
    const idx = assistantIndex(out.messages);
    const run = toolRunAfter(out.messages, idx);

    expect(run.map((m) => m.tool_call_id)).toEqual(["call_A", "call_B"]);
    expect(run.map((m) => m.content)).toEqual(["result A", "result B"]);
    expect(JSON.stringify(out)).not.toContain(SYNTHETIC_TOOL_RESULT_TEXT);
  });

  it("does not double-inject when the batch had no reply at all", () => {
    // fixMissingToolResponses (pre-translation) already inserted one empty
    // placeholder per id; the per-id pass must see them as answered.
    const out = toOpenAI(unansweredBody());
    const idx = assistantIndex(out.messages);
    const run = toolRunAfter(out.messages, idx);

    expect(run.map((m) => m.tool_call_id)).toEqual(["call_A", "call_B"]);
    expect(run).toHaveLength(2);
  });

  it("leaves a trailing assistant prefill alone", () => {
    const body = {
      model: "gpt-x",
      messages: [
        { role: "user", content: "start" },
        assistantWithCalls(["call_A"]),
      ],
    };
    const out = toOpenAI(body);
    expect(out.messages.filter((m) => m.role === "tool")).toEqual([]);
  });

  it("repairs the same partial batch when the source is Responses input", () => {
    const body = {
      model: "gpt-x",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "two lookups" }] },
        { type: "function_call", call_id: "call_A", name: "Read", arguments: "{}" },
        { type: "function_call", call_id: "call_B", name: "Read", arguments: "{}" },
        { type: "function_call_output", call_id: "call_A", output: "result A" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
    };
    const out = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      "gpt-x",
      clone(body),
      true,
      null,
      "openai"
    );
    const idx = assistantIndex(out.messages);
    const run = toolRunAfter(out.messages, idx);

    expect(run.map((m) => m.tool_call_id)).toEqual(["call_A", "call_B"]);
    expect(run[0].content).toBe("result A");
    expect(run[1].content).toBe(SYNTHETIC_TOOL_RESULT_TEXT);
  });
});
