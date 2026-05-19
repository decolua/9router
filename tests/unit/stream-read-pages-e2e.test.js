import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import "../../open-sse/translator/response/openai-to-claude.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeBody(tool) {
  return {
    model: "cx/gpt-5.5-high[1m]",
    stream: true,
    messages: [{ role: "user", content: [{ type: "text", text: "read the file" }] }],
    tools: [tool],
  };
}

async function transformToolCall(tool, toolName, args) {
  const body = makeBody(tool);
  const chunks = [
    `data: ${JSON.stringify({ id: "chatcmpl_e2e", model: "gpt-5.5-high", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: toolName, arguments: "" } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];

  const input = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const transform = createSSETransformStreamWithLogger(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    "codex",
    null,
    null,
    "cx/gpt-5.5-high[1m]",
    "e2e-conn",
    body,
    null,
    null,
  );

  const reader = input.pipeThrough(transform).getReader();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function extractArgs(output) {
  globalThis.__lastOutput = output;
  const partials = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;
    const event = JSON.parse(payload);
    if (!event) continue;
    if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      partials.push(event.delta.partial_json);
    }
  }
  expect(partials.length).toBeGreaterThan(0);
  return JSON.parse(partials.join(""));
}

describe("OpenAI stream to Claude Read args E2E", () => {
  it("handles Read pages empty string according to EXPECT_FIXED", async () => {
    const output = await transformToolCall(
      {
        name: "Read",
        input_schema: {
          type: "object",
          properties: {
            file_path: { type: "string" },
            offset: { type: "number" },
            limit: { type: "number" },
            pages: { type: "string" },
          },
          required: ["file_path"],
        },
      },
      "Read",
      JSON.stringify({ file_path: "/tmp/example.txt", offset: 0, limit: 120, pages: "" }),
    );

    const args = extractArgs(output);
    expect(args.file_path).toBe("/tmp/example.txt");
    expect(args.offset).toBe(0);
    expect(args.limit).toBe(120);

    if (process.env.EXPECT_FIXED === "1") {
      expect(args).not.toHaveProperty("pages");
    } else {
      expect(args.pages).toBe("");
    }
  });

  it("preserves required empty strings when fixed", async () => {
    if (process.env.EXPECT_FIXED !== "1") return;

    const output = await transformToolCall(
      {
        name: "RequiredEmpty",
        input_schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
      "RequiredEmpty",
      JSON.stringify({ value: "" }),
    );

    expect(extractArgs(output)).toEqual({ value: "" });
  });
});
