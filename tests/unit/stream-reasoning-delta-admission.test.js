import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { hasValuableContent } from "../../open-sse/utils/streamHelpers.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

// Cline streams reasoning as `delta.reasoning` + `delta.reasoning_details[]`, never
// `delta.reasoning_content`. A chunk carrying only those used to be dropped.
const reasoningChunk = (text) => ({
  id: "chatcmpl-cline",
  object: "chat.completion.chunk",
  created: 1758585600,
  model: "cline-free/deepseek-v4.1-flash",
  choices: [{
    index: 0,
    delta: {
      reasoning: text,
      reasoning_details: [{ type: "reasoning.text", text, format: "unknown", index: 0 }],
    },
    finish_reason: null,
  }],
});

const contentChunk = (text) => ({
  id: "chatcmpl-cline",
  object: "chat.completion.chunk",
  created: 1758585600,
  model: "cline-free/deepseek-v4.1-flash",
  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
});

const finishChunk = () => ({
  id: "chatcmpl-cline",
  object: "chat.completion.chunk",
  created: 1758585600,
  model: "cline-free/deepseek-v4.1-flash",
  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13, reasoning_tokens: 2 },
});

const sse = (...chunks) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");

async function runPassthrough(input) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  let completed = null;
  const output = stream.pipeThrough(
    createPassthroughStreamWithLogger(
      "cline", null, "cline-free/deepseek-v4.1-flash", null, null,
      (result) => { completed = result; }, null,
    ),
  );

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return { text: text + decoder.decode(), completed };
}

const deltas = (out) => out
  .split("\n")
  .filter((l) => l.startsWith("data: ") && l.trim() !== "data: [DONE]")
  .map((l) => JSON.parse(l.slice(6)));

describe("hasValuableContent: reasoning delta shapes (OpenAI format)", () => {
  it("keeps a delta carrying only delta.reasoning", () => {
    const chunk = { choices: [{ index: 0, delta: { reasoning: "We" }, finish_reason: null }] };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeTruthy();
  });

  it("keeps a delta carrying only a non-empty delta.reasoning_details[]", () => {
    const chunk = {
      choices: [{
        index: 0,
        delta: { reasoning_details: [{ type: "reasoning.summary", summary: "Performing abstract" }] },
        finish_reason: null,
      }],
    };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeTruthy();
  });

  it("keeps a delta carrying only delta.reasoning_content (unchanged)", () => {
    const chunk = { choices: [{ index: 0, delta: { reasoning_content: "We" }, finish_reason: null }] };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBe(true);
  });

  it("still drops a delta with nothing in it", () => {
    const chunk = { choices: [{ index: 0, delta: {}, finish_reason: null }] };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeFalsy();
  });

  it("still drops an empty reasoning_details array", () => {
    const chunk = { choices: [{ index: 0, delta: { reasoning: "", reasoning_details: [] }, finish_reason: null }] };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeFalsy();
  });

  it("keeps content, tool_calls, finish_reason and role deltas (unchanged)", () => {
    const at = (delta) => hasValuableContent({ choices: [{ index: 0, delta, finish_reason: null }] }, FORMATS.OPENAI);
    expect(at({ content: "hi" })).toBeTruthy();
    expect(at({ tool_calls: [{ index: 0 }] })).toBeTruthy();
    expect(at({ role: "assistant" })).toBeTruthy();
    expect(
      hasValuableContent({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }, FORMATS.OPENAI),
    ).toBeTruthy();
  });
});

describe("passthrough stream: Cline reasoning chunks reach the client", () => {
  it("forwards every reasoning chunk instead of the first one only", async () => {
    const { text } = await runPassthrough(
      sse(
        { ...reasoningChunk("We"), choices: [{ index: 0, delta: { role: "assistant", reasoning: "We" }, finish_reason: null }] },
        reasoningChunk(" need to multiply"),
        reasoningChunk(" 17 by 23."),
        contentChunk("391"),
        finishChunk(),
      ),
    );

    const reasoning = deltas(text)
      .map((c) => c.choices?.[0]?.delta?.reasoning || "")
      .join("");
    expect(reasoning).toBe("We need to multiply 17 by 23.");
  });

  it("keeps the structured reasoning_details the client renders", async () => {
    const { text } = await runPassthrough(sse(reasoningChunk("We"), contentChunk("ok"), finishChunk()));
    const details = deltas(text).flatMap((c) => c.choices?.[0]?.delta?.reasoning_details || []);
    expect(details).toHaveLength(1);
    expect(details[0].text).toBe("We");
  });

  it("counts streamed reasoning toward the thinking trace and the output estimate", async () => {
    const { completed } = await runPassthrough(sse(reasoningChunk("thinking hard"), contentChunk("391"), finishChunk()));
    expect(completed.thinking).toBe("thinking hard");
    expect(completed.content).toBe("391");
  });
});
