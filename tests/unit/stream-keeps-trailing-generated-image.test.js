import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

/**
 * The wiring, not the predicate.
 *
 * `stream-keeps-generated-images.test.js` calls `hasValuableContent` directly, which
 * proves the predicate and nothing about the stream that consults it. A chunk the gate
 * drops is never enqueued, and at the end of a stream there is no later chunk to carry
 * the image instead — so an images-only chunk arriving last is dropped with no error and
 * no trace, which is the failure this bundle is about.
 *
 * These drive the real transform: Gemini upstream, OpenAI client, with the image part as
 * the final thing the provider sends.
 */
async function runGeminiStream(chunks) {
  const encoder = new TextEncoder();
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("");

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  const output = stream.pipeThrough(
    createSSETransformStreamWithLogger(
      FORMATS.GEMINI,
      FORMATS.OPENAI,
      "gemini",
      null,
      null,
      "gemini-3.5-flash-image",
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
  return text + decoder.decode();
}

const deltas = (sse) => sse
  .split("\n")
  .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
  .map((l) => JSON.parse(l.slice(6)));

const textPart = (text) => ({
  candidates: [{ content: { parts: [{ text }] }, index: 0 }],
});

const imagePart = (data = "iVBORw0KGgo=") => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] }, index: 0 }],
});

const finishPart = () => ({
  candidates: [{ content: { parts: [] }, finishReason: "STOP", index: 0 }],
});

function imagesFrom(sse) {
  return deltas(sse).flatMap((d) => d.choices?.[0]?.delta?.images ?? []);
}

describe("a generated image that arrives last still reaches the client", () => {
  it("survives when the image part is the final chunk of the stream", async () => {
    const sse = await runGeminiStream([textPart("here you go"), imagePart()]);
    const images = imagesFrom(sse);

    expect(images, "the trailing image chunk never reached the client").toHaveLength(1);
    expect(images[0].image_url.url).toBe("data:image/png;base64,iVBORw0KGgo=");

    // And the text before it is still there, so this is not "everything passed".
    const text = deltas(sse).map((d) => d.choices?.[0]?.delta?.content ?? "").join("");
    expect(text).toBe("here you go");
  });

  it("survives when the image part is the whole response", async () => {
    // No text, no finish chunk: if the gate drops this one the client gets an
    // assistant message that is well-formed and completely empty.
    const images = imagesFrom(await runGeminiStream([imagePart()]));
    expect(images).toHaveLength(1);
  });

  it("survives a finish chunk following it, and is not duplicated by one", async () => {
    const images = imagesFrom(await runGeminiStream([imagePart(), finishPart()]));
    expect(images).toHaveLength(1);
  });

  it("keeps every image when several arrive back to back at the end", async () => {
    const sse = await runGeminiStream([
      textPart("two of them"),
      imagePart("AAAAAAAAAA=="),
      imagePart("BBBBBBBBBB=="),
    ]);
    const urls = imagesFrom(sse).map((i) => i.image_url.url);

    expect(urls).toEqual([
      "data:image/png;base64,AAAAAAAAAA==",
      "data:image/png;base64,BBBBBBBBBB==",
    ]);
  });
});
