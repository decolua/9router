import { describe, expect, it } from "vitest";
import { ensureStreamToolCallIds } from "../../open-sse/utils/streamHelpers.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const chunk = (delta, finishReason = null, usage) => ({
  id: "chatcmpl-empty-tool-test", object: "chat.completion.chunk",
  created: 1700000000, model: "test-model",
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...(usage ? { usage } : {}),
});
const placeholder = (index) => ({
  ...(index === undefined ? {} : { index }),
  id: null, function: { name: null, arguments: null },
});

describe("empty streamed tool-call placeholders (#5345)", () => {
  it.each([
    ["all-null report payload", placeholder()],
    ["indexed null fields", placeholder(0)],
    ["index-only fragment", { index: 0 }],
    ["empty function fields", { index: 0, type: "function", id: "", function: { name: "", arguments: "" } }],
  ])("removes %s without allocating a tool-call id", (_name, call) => {
    const seen = new Map();
    const input = chunk({ content: null, tool_calls: [call] });
    expect(ensureStreamToolCallIds(input, seen)).toBe(true);
    expect(input.choices[0].delta).not.toHaveProperty("tool_calls");
    expect(seen.size).toBe(0);
  });

  it("does not leave an empty tool_calls array beside reasoning", () => {
    const input = chunk({ reasoning_content: "checking", tool_calls: [placeholder(0)] });
    ensureStreamToolCallIds(input, new Map());
    expect(input.choices[0].delta).toEqual({ reasoning_content: "checking" });
  });

  it("keeps a real start with empty arguments and its original index", () => {
    const call = { index: 2, id: "call_real", type: "function", function: { name: "read", arguments: "" } };
    const input = chunk({ tool_calls: [placeholder(0), structuredClone(call)] });
    const seen = new Map();
    ensureStreamToolCallIds(input, seen);
    expect(input.choices[0].delta.tool_calls).toEqual([call]);
    expect([...seen]).toEqual([[2, "call_real"]]);
  });

  it("keeps argument fragments, including whitespace, and reuses their id", () => {
    const seen = new Map([[2, "call_real"]]);
    for (const args of ['{"path":', " ", '"a.txt"}']) {
      const input = chunk({ tool_calls: [{ index: 2, function: { arguments: args } }] });
      ensureStreamToolCallIds(input, seen);
      expect(input.choices[0].delta.tool_calls).toEqual([
        { index: 2, id: "call_real", function: { arguments: args } },
      ]);
    }
  });

  it("retains id-only and name-only fragments rather than demanding a complete start", () => {
    const seen = new Map();
    const idOnly = chunk({ tool_calls: [{ index: 0, id: "call_upstream" }] });
    ensureStreamToolCallIds(idOnly, seen);
    const nameOnly = chunk({ tool_calls: [{ index: 0, function: { name: "read" } }] });
    ensureStreamToolCallIds(nameOnly, seen);
    expect(idOnly.choices[0].delta.tool_calls[0].id).toBe("call_upstream");
    expect(nameOnly.choices[0].delta.tool_calls[0]).toEqual({
      index: 0, id: "call_upstream", function: { name: "read" },
    });
  });

  it("does not treat a custom tool's input as an empty function delta", () => {
    const call = { index: 0, type: "custom", custom: { name: "shell", input: "ls" } };
    const input = chunk({ tool_calls: [structuredClone(call)] });
    ensureStreamToolCallIds(input, new Map());
    expect(input.choices[0].delta.tool_calls[0]).toMatchObject(call);
  });

  it("retains provider extension data instead of assuming it is empty", () => {
    for (const extension of [
      { extra_content: { google: { thought_signature: "opaque" } } },
      { function: { provider_metadata: "opaque" } },
    ]) {
      const call = { index: 0, ...extension };
      const input = chunk({ tool_calls: [structuredClone(call)] });
      ensureStreamToolCallIds(input, new Map());
      expect(input.choices[0].delta.tool_calls[0]).toMatchObject(call);
    }
  });

  it("removes a no-op continuation without disturbing the existing id", () => {
    const seen = new Map([[0, "call_existing"]]);
    const input = chunk({ tool_calls: [placeholder(0)] });
    ensureStreamToolCallIds(input, seen);
    expect(input.choices[0].delta).not.toHaveProperty("tool_calls");
    expect([...seen]).toEqual([[0, "call_existing"]]);
  });

  it("normalizes every choice without discarding sibling content or usage", () => {
    const input = chunk({ content: "answer", tool_calls: [placeholder(0)] }, "stop", {
      prompt_tokens: 10, completion_tokens: 2, total_tokens: 12,
    });
    input.choices.push({ index: 1, delta: { reasoning_content: "note", tool_calls: [placeholder(3)] }, finish_reason: null });
    ensureStreamToolCallIds(input, new Map());
    expect(input.choices.map(c => c.delta)).toEqual([{ content: "answer" }, { reasoning_content: "note" }]);
    expect(input.choices[0].finish_reason).toBe("stop");
    expect(input.usage.total_tokens).toBe(12);
  });
});

describe("outbound OpenAI stream paths", () => {
  it("same-format translation drops the placeholder before assigning ids", () => {
    const state = initState(FORMATS.OPENAI);
    const out = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI,
      chunk({ content: "hello", tool_calls: [placeholder(0)] }), state);
    expect(out[0].choices[0].delta).toEqual({ content: "hello" });
    expect(state.streamToolCallIds.size).toBe(0);
  });

  async function passthrough(chunks, splitBytes) {
    const bytes = new TextEncoder().encode(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n");
    const stream = createSSEStream({ mode: "passthrough", provider: "opencode" });
    const read = new Response(stream.readable).text();
    const writer = stream.writable.getWriter();
    const stride = splitBytes ? 7 : bytes.length;
    for (let i = 0; i < bytes.length; i += stride) await writer.write(bytes.subarray(i, i + stride));
    await writer.close();
    return (await read).split("\n").filter(l => l.startsWith("data: "))
      .map(l => l.slice(6)).map(s => s === "[DONE]" ? s : JSON.parse(s));
  }

  it.each([false, true])("reconstructs a real call after a null placeholder (fragmented transport: %s)", async splitBytes => {
    const clean = [
      chunk({ role: "assistant" }),
      chunk({ reasoning_content: "checking" }),
      chunk({ tool_calls: [{ index: 0, id: "call_real", type: "function", function: { name: "read", arguments: '{"path":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }),
      chunk({}, "tool_calls", { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }),
    ];
    const control = await passthrough(clean, splitBytes);
    const out = await passthrough([
      clean[0],
      chunk({ content: null, tool_calls: [placeholder(0)] }),
      chunk({ reasoning_content: "checking", tool_calls: [placeholder(0)] }),
      ...clean.slice(2),
    ], splitBytes);
    const calls = out.flatMap(c => c.choices?.[0]?.delta?.tool_calls || []);
    expect(calls).toHaveLength(2);
    expect(calls.map(c => c.id)).toEqual(["call_real", "call_real"]);
    expect(calls[0].function.name).toBe("read");
    expect(JSON.parse(calls.map(c => c.function.arguments).join(""))).toEqual({ path: "a.txt" });
    const reasoning = out.find(c => c.choices?.[0]?.delta?.reasoning_content);
    expect(reasoning.choices[0].delta).toEqual({ reasoning_content: "checking" });
    const terminal = out.find(c => c.choices?.[0]?.finish_reason);
    expect(terminal.choices[0].finish_reason).toBe("tool_calls");
    // The passthrough's existing usage buffering is out of scope. Empty tool
    // placeholders must not change the result compared with the clean stream.
    expect(terminal.usage).toEqual(control.find(c => c.choices?.[0]?.finish_reason).usage);
    expect(terminal.usage.completion_tokens).toBe(2);
    expect(out).toContain("[DONE]");
    expect(out.filter(c => c === "[DONE]")).toEqual(control.filter(c => c === "[DONE]"));
  });
});
