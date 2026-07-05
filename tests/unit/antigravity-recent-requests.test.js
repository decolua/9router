import { describe, expect, it, vi } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.js";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

async function writeAndCollect(transform, chunks) {
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const readAll = (async () => {
    const out = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
    }
    return out;
  })();

  for (const chunk of chunks) {
    await writer.write(new TextEncoder().encode(chunk));
  }
  await writer.close();
  return await readAll;
}

describe("Antigravity Recent Requests usage", () => {
  it("finalizes native Antigravity usage when the final chunk arrives before stream close", async () => {
    let completed = null;
    const stream = createPassthroughStreamWithLogger(
      "antigravity",
      null,
      "claude-opus-4-6-thinking",
      "conn-1",
      { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const readOne = reader.read();

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "AG_NATIVE_USAGE_OK" }],
          },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 18,
          candidatesTokenCount: 12,
          totalTokenCount: 30,
        },
      },
    };

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    await readOne;

    expect(completed?.content?.content).toBe("AG_NATIVE_USAGE_OK");
    expect(completed?.usage).toMatchObject({
      prompt_tokens: 18,
      completion_tokens: 12,
      total_tokens: 30,
    });

    await writer.abort();
    await reader.cancel().catch(() => {});
  });

  it("estimates usage for Antigravity passthrough content when upstream omits usageMetadata", async () => {
    let completed = null;
    const stream = createPassthroughStreamWithLogger(
      "antigravity",
      null,
      "gemini-pro-agent",
      "conn-1",
      { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "A useful Antigravity response." }],
          },
          finishReason: "STOP",
        }],
      },
    };

    await writeAndCollect(stream, [`data: ${JSON.stringify(event)}\n\n`]);

    expect(completed?.content?.content).toBe("A useful Antigravity response.");
    expect(completed?.usage?.prompt_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.completion_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.estimated).toBe(true);
  });

  it("estimates usage for translated Antigravity wrapped content when upstream omits usageMetadata", async () => {
    let completed = null;
    const stream = createSSETransformStreamWithLogger(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
      "antigravity",
      null,
      null,
      "claude-opus-4-6-thinking",
      "conn-1",
      { messages: [{ role: "user", content: "hello" }] },
      (content, usage) => {
        completed = { content, usage };
      },
      null,
    );

    const event = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Translated Antigravity response." }],
          },
          finishReason: "STOP",
        }],
      },
    };

    await writeAndCollect(stream, [`data: ${JSON.stringify(event)}\n\n`]);

    expect(completed?.content?.content).toBe("Translated Antigravity response.");
    expect(completed?.usage?.prompt_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.completion_tokens).toBeGreaterThan(0);
    expect(completed?.usage?.estimated).toBe(true);
  });
});
