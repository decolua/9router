import { describe, it, expect } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

function cursorResponseFrame({ text = "", thinking = "" }) {
  const responseFields = [];

  if (text) {
    responseFields.push(encodeField(1, LEN, text));
  }

  if (thinking) {
    const thinkingMessage = encodeField(1, LEN, thinking);
    responseFields.push(encodeField(25, LEN, thinkingMessage));
  }

  const response = Buffer.concat(responseFields.map((field) => Buffer.from(field)));
  const envelope = encodeField(2, LEN, response);
  return Buffer.from(wrapConnectRPCFrame(envelope));
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

describe("CursorExecutor Composer thinking-field responses", () => {
  it("uses visible content after </think> for non-streaming Composer responses", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning that must not leak</think>OK",
    });

    const response = executor.transformProtobufToJSON(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBe("OK");
    expect(JSON.stringify(payload)).not.toContain("private reasoning");
    expect(payload.usage.completion_tokens).toBeGreaterThan(0);
  });

  it("streams only visible content after </think> for Composer responses", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private reasoning" }),
      cursorResponseFrame({ thinking: " that must not leak</think>O" }),
      cursorResponseFrame({ thinking: "K" }),
    ]);

    const response = executor.transformProtobufToSSE(buffer, "composer-2.5-fast", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const events = parseSSE(await response.text());
    const content = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .join("");

    expect(content).toBe("OK");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
    expect(events.at(-1).usage.completion_tokens).toBeGreaterThan(0);
  });

  it("does not treat thinking as visible output for non-Composer models", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning</think>SHOULD_NOT_APPEAR",
    });

    const response = executor.transformProtobufToJSON(buffer, "gpt-5.3-codex", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("SHOULD_NOT_APPEAR");
  });

  it("strips Composer `<｜final｜>` sentinel markers from non-streaming output", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "reasoning</think><｜final｜>OK_PR1310<｜/final｜>",
    });

    const response = executor.transformProtobufToJSON(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBe("OK_PR1310");
    expect(payload.choices[0].message.content).not.toMatch(/final/i);
  });

  it("strips ASCII `<|final|>` sentinel markers from non-streaming output", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "reasoning</think><|final|>HELLO<|/final|>",
    });

    const response = executor.transformProtobufToJSON(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBe("HELLO");
  });

  it("does not leak partial `<｜final｜>` marker across streamed Composer chunks", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "reasoning</think><｜fina" }),
      cursorResponseFrame({ thinking: "l｜>OK_S" }),
      cursorResponseFrame({ thinking: "TREAM" }),
    ]);

    const response = executor.transformProtobufToSSE(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "reply" }],
    });
    const events = parseSSE(await response.text());
    const content = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .join("");

    expect(content).toBe("OK_STREAM");
    expect(JSON.stringify(events)).not.toContain("final");
    expect(JSON.stringify(events)).not.toContain("｜");
  });

  it("converts inline DeepSeek tool calls into OpenAI tool_calls (non-streaming)", async () => {
    const executor = new CursorExecutor();
    const composerOutput =
      "Searching now.\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nsearch_files\n" +
      "<｜tool▁sep｜>pattern\n*cron*.py\n" +
      "<｜tool▁sep｜>path\n/home/noestelar/.hermes\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    const buffer = cursorResponseFrame({ thinking: `reasoning</think>${composerOutput}` });

    const response = executor.transformProtobufToJSON(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "find cron files" }],
    });
    const payload = JSON.parse(await response.text());

    expect(payload.choices[0].finish_reason).toBe("tool_calls");
    expect(payload.choices[0].message.tool_calls).toBeInstanceOf(Array);
    expect(payload.choices[0].message.tool_calls).toHaveLength(1);
    const tc = payload.choices[0].message.tool_calls[0];
    expect(tc.type).toBe("function");
    expect(tc.function.name).toBe("search_files");
    expect(JSON.parse(tc.function.arguments)).toEqual({
      pattern: "*cron*.py",
      path: "/home/noestelar/.hermes",
    });
    // Preamble text is preserved as the assistant's visible content.
    expect(payload.choices[0].message.content).toBe("Searching now.");
    // No marker leak anywhere.
    expect(JSON.stringify(payload)).not.toContain("tool▁calls▁begin");
  });

  it("emits structured tool_calls SSE chunks for inline DeepSeek format and suppresses marker text", async () => {
    const executor = new CursorExecutor();
    const composerOutput =
      "Searching now.\n<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>\nsearch_files\n" +
      "<｜tool▁sep｜>pattern\ncron\n" +
      "<｜tool▁call▁end｜><｜tool▁calls▁end｜>";
    // Split across multiple frames to exercise the streaming parser.
    const split1 = composerOutput.slice(0, 22);
    const split2 = composerOutput.slice(22, 60);
    const split3 = composerOutput.slice(60);
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: `reasoning</think>${split1}` }),
      cursorResponseFrame({ thinking: split2 }),
      cursorResponseFrame({ thinking: split3 }),
    ]);

    const response = executor.transformProtobufToSSE(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "find cron" }],
    });
    const events = parseSSE(await response.text());

    const content = events
      .map((e) => e.choices?.[0]?.delta?.content || "")
      .join("");
    // Only the preamble text should be emitted as visible content; no markers.
    expect(content).toContain("Searching now.");
    expect(content).not.toContain("tool▁calls▁begin");
    expect(content).not.toContain("｜");

    // tool_calls deltas should be present and correct.
    const toolCallDeltas = events
      .flatMap((e) => e.choices?.[0]?.delta?.tool_calls || []);
    expect(toolCallDeltas.length).toBeGreaterThan(0);
    expect(toolCallDeltas[0].function.name).toBe("search_files");
    expect(JSON.parse(toolCallDeltas[0].function.arguments)).toEqual({ pattern: "cron" });

    // finish_reason should be tool_calls on the final chunk.
    const finishChunk = events.find((e) => e.choices?.[0]?.finish_reason);
    expect(finishChunk.choices[0].finish_reason).toBe("tool_calls");
  });
});
