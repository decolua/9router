import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

async function runPassthrough(provider, input, chunkSize = input.length) {
  const encoder = new TextEncoder();
  const inputStream = new ReadableStream({
    start(controller) {
      for (let index = 0; index < input.length; index += chunkSize) {
        controller.enqueue(encoder.encode(input.slice(index, index + chunkSize)));
      }
      controller.close();
    },
  });
  const outputStream = inputStream.pipeThrough(
    createPassthroughStreamWithLogger(provider),
  );
  const reader = outputStream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function firstDataEvent(output) {
  const line = output.split("\n").find((item) => item.startsWith("data: {"));
  return JSON.parse(line.slice(6));
}

describe("MiniMax Anthropic thinking stream", () => {
  it.each(["minimax", "minimax-cn"])(
    "enables thinking signature normalization for %s",
    (provider) => {
      expect(PROVIDERS[provider].quirks.ensureThinkingSignature).toBe(true);
    },
  );

  it.each(["minimax", "minimax-cn"])(
    "adds a deserializable signature field for %s thinking block starts",
    async (provider) => {
      const event = {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      };
      const output = await runPassthrough(
        provider,
        `event: content_block_start\ndata: ${JSON.stringify(event)}\n\n`,
      );

      expect(firstDataEvent(output).content_block.signature).toBe("");
    },
  );

  it("preserves real signature events across fragmented chunks", async () => {
    const start = {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    };
    const signature = {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "minimax-signature" },
    };
    const output = await runPassthrough(
      "minimax",
      `event: content_block_start\ndata: ${JSON.stringify(start)}\n\n` +
        `event: content_block_delta\ndata: ${JSON.stringify(signature)}\n\n`,
      7,
    );
    const events = output
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));

    expect(events[0].content_block.signature).toBe("");
    expect(events[1].delta).toEqual({
      type: "signature_delta",
      signature: "minimax-signature",
    });
  });

  it("preserves a MiniMax signature already present on the block start", async () => {
    const event = {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "", signature: "minimax-signature" },
    };
    const output = await runPassthrough(
      "minimax",
      `event: content_block_start\ndata: ${JSON.stringify(event)}\n\n`,
    );

    expect(firstDataEvent(output).content_block.signature).toBe("minimax-signature");
  });

  it("does not modify unsigned thinking starts from unrelated providers", async () => {
    const event = {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    };
    const output = await runPassthrough(
      "deepseek",
      `event: content_block_start\ndata: ${JSON.stringify(event)}\n\n`,
    );

    expect(firstDataEvent(output).content_block).not.toHaveProperty("signature");
  });
});
