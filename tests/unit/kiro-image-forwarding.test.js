import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { intercept } = require("../../src/mitm/handlers/kiro.js");

const MODEL = "offline-test-model";

function makeResponseCollector() {
  const chunks = [];
  const response = {
    headersSent: false,
    statusCode: undefined,
    ended: false,
    writeHead(statusCode) {
      this.statusCode = statusCode;
      this.headersSent = true;
      return this;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk));
      this.ended = true;
      this.headersSent = true;
      return this;
    },
  };

  return { response, chunks };
}

async function captureOpenAIRequest(request) {
  const originalFetch = globalThis.fetch;
  const { response, chunks } = makeResponseCollector();
  let captured;

  const fetchMock = vi.fn(async (url, init) => {
    captured = { url: String(url), init };
    return new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  globalThis.fetch = fetchMock;

  try {
    await intercept(
      { headers: { "x-test": "kiro-image-forwarding" } },
      response,
      Buffer.from(JSON.stringify(request)),
      MODEL,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.url.endsWith("/v1/chat/completions")).toBe(true);
    expect(captured.init.method).toBe("POST");
    expect(response.statusCode).toBe(200);
    expect(response.ended).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);

    return JSON.parse(captured.init.body);
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
}

function image(format, bytes) {
  return { format, source: { bytes } };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Kiro MITM inline image forwarding", () => {
  it("forwards text and inline images as OpenAI image_url content parts", async () => {
    const outboundBody = await captureOpenAIRequest({
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "  Describe this  ",
            images: [image("png", "aGVsbG8=")],
          },
        },
      },
    });

    expect(outboundBody).toMatchObject({
      model: MODEL,
      stream: true,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        ],
      }],
    });
  });

  it("emits an image-only user turn even when tool results are present", async () => {
    const outboundBody = await captureOpenAIRequest({
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "   ",
            images: [image("jpg", "LzlqLzQ=")],
            userInputMessageContext: {
              toolResults: [
                { toolUseId: "tool-a", content: [{ text: "first" }, { text: "result" }] },
                { toolUseId: "tool-b", content: [{ text: "second" }] },
              ],
            },
          },
        },
      },
    });

    expect(outboundBody.messages).toEqual([
      { role: "tool", tool_call_id: "tool-a", content: "first\nresult" },
      { role: "tool", tool_call_id: "tool-b", content: "second" },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,LzlqLzQ=" } },
        ],
      },
    ]);
  });

  it("keeps historical images on their original user turn", async () => {
    const outboundBody = await captureOpenAIRequest({
      conversationState: {
        history: [
          {
            userInputMessage: {
              content: "  historical evidence  ",
              images: [image("jpeg", "anBlZw=="), image("webp", "d2VicA==")],
            },
          },
          { assistantResponseMessage: { content: "assistant reply" } },
        ],
        currentMessage: { userInputMessage: { content: "current question" } },
      },
    });

    expect(outboundBody.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "historical evidence" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,anBlZw==" } },
          { type: "image_url", image_url: { url: "data:image/webp;base64,d2VicA==" } },
        ],
      },
      { role: "assistant", content: "assistant reply" },
      { role: "user", content: "current question" },
    ]);
  });

  it("ignores malformed and unsupported image entries without changing text-only behavior", async () => {
    const outboundBody = await captureOpenAIRequest({
      conversationState: {
        history: [],
        currentMessage: {
          userInputMessage: {
            content: "  keep this text  ",
            images: [
              image("svg", "ignored"),
              image("PNG", "ignored"),
              image("jpeg", ""),
              { format: "gif", source: { bytes: 42 } },
              null,
              [],
            ],
          },
        },
      },
    });

    expect(outboundBody.messages).toEqual([
      { role: "user", content: "keep this text" },
    ]);
  });
});
