import { describe, expect, it } from "vitest";

import { clientRequestedStreaming } from "../../open-sse/handlers/chatCore/streamMode.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

/**
 * chatCore resolved the response framing with `body.stream !== false`, which
 * reads an absent `stream` key as "stream". The OpenAI API defines `stream`
 * with a default of false, so a body without the key is a non-streaming
 * request — and the response came back as `text/event-stream` with a
 * `data: [DONE]` appended to a plain `chat.completion` object, which strict
 * JSON clients cannot parse (#3492).
 *
 * chatCore now reads the mode from here:
 *   let stream = providerRequiresStreaming ? true : clientRequestedStreaming;
 */
const chat = (extra = {}) => ({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "say OK" }],
  ...extra,
});

describe("clientRequestedStreaming", () => {
  it("reads a body with no stream key as non-streaming", () => {
    expect(clientRequestedStreaming(chat(), FORMATS.OPENAI)).toBe(false);
  });

  it("reads an explicit stream:false as non-streaming", () => {
    expect(clientRequestedStreaming(chat({ stream: false }), FORMATS.OPENAI)).toBe(false);
  });

  it("reads an explicit stream:true as streaming", () => {
    expect(clientRequestedStreaming(chat({ stream: true }), FORMATS.OPENAI)).toBe(true);
  });

  it("does not treat a truthy non-boolean as a request to stream", () => {
    for (const value of ["true", 1, {}]) {
      expect(clientRequestedStreaming(chat({ stream: value }), FORMATS.OPENAI)).toBe(false);
    }
  });

  it("keeps the Gemini and Antigravity surfaces on SSE regardless of the body", () => {
    for (const format of [FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.ANTIGRAVITY]) {
      expect(clientRequestedStreaming(chat(), format)).toBe(true);
      expect(clientRequestedStreaming(chat({ stream: false }), format)).toBe(true);
    }
  });

  it("treats the Claude surface like OpenAI", () => {
    expect(clientRequestedStreaming(chat(), FORMATS.CLAUDE)).toBe(false);
    expect(clientRequestedStreaming(chat({ stream: true }), FORMATS.CLAUDE)).toBe(true);
  });

  it("survives a missing body", () => {
    expect(clientRequestedStreaming(undefined, FORMATS.OPENAI)).toBe(false);
  });
});
