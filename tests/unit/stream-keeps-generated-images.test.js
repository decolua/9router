import { describe, expect, it } from "vitest";

import { hasValuableContent } from "../../open-sse/utils/streamHelpers.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

/**
 * `hasValuableContent` gates every chunk on the streaming path
 * (open-sse/utils/stream.js:315). A generated image arrives on its own chunk with
 * nothing else in the delta, so leaving `images` out of the check dropped it — and
 * the client received a well-formed but empty assistant message.
 *
 * The shape below is the one the translator emits at
 * open-sse/translator/response/gemini-to-openai.js:105, and the one the repo's own
 * golden snapshot locks for "image output (inlineData → delta.images)".
 */
const imageChunk = () => ({
  choices: [
    {
      index: 0,
      delta: {
        images: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
          },
        ],
      },
      finish_reason: null,
    },
  ],
});

describe("hasValuableContent — OpenAI format", () => {
  it("keeps a chunk carrying only a generated image", () => {
    expect(hasValuableContent(imageChunk(), FORMATS.OPENAI)).toBeTruthy();
  });

  it("still drops a chunk whose delta is genuinely empty", () => {
    const empty = { choices: [{ index: 0, delta: {}, finish_reason: null }] };
    expect(hasValuableContent(empty, FORMATS.OPENAI)).toBeFalsy();
  });

  it("drops an empty images array rather than treating it as content", () => {
    const chunk = imageChunk();
    chunk.choices[0].delta.images = [];
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeFalsy();
  });

  it("keeps the shapes it already kept", () => {
    const text = { choices: [{ delta: { content: "hi" } }] };
    const reasoning = { choices: [{ delta: { reasoning_content: "why" } }] };
    const tools = { choices: [{ delta: { tool_calls: [{ index: 0 }] } }] };
    const role = { choices: [{ delta: { role: "assistant" } }] };
    const finish = { choices: [{ delta: {}, finish_reason: "stop" }] };
    for (const chunk of [text, reasoning, tools, role, finish]) {
      expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeTruthy();
    }
  });
});
