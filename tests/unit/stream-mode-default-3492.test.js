import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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

// The tests above exercise clientRequestedStreaming in isolation. They all keep
// passing if chatCore.js goes back to its own `body.stream !== false`, because
// nothing here observes the call site — reverting the wiring alone left this
// file green, which is exactly the shape of bug this PR is about. handleChatCore
// takes ~30 collaborators and cannot be driven from a unit test, so pin the
// wiring at the source level instead.
describe("chatCore reads the stream mode from streamMode.js (#3492)", () => {
  const source = readFileSync(
    new URL("../../open-sse/handlers/chatCore.js", import.meta.url),
    "utf8",
  );

  it("imports the helper", () => {
    expect(source).toMatch(
      /import\s*\{\s*clientRequestedStreaming[^}]*\}\s*from\s*["']\.\/chatCore\/streamMode\.js["']/,
    );
  });

  it("derives the streaming decision from it", () => {
    expect(source).toMatch(/const\s+clientRequestedStreaming\s*=\s*requestedStreaming\(\s*body\s*,\s*sourceFormat\s*\)/);
    expect(source).toMatch(/let\s+stream\s*=\s*providerRequiresStreaming\s*\?\s*true\s*:\s*clientRequestedStreaming/);
  });

  it("no longer decides the response framing with `body.stream !== false`", () => {
    // The Accept-header branch still reads `body.stream !== true`; only the
    // `!== false` spelling, which is what treated an absent key as streaming,
    // must be gone.
    expect(source).not.toMatch(/body\.stream\s*!==\s*false/);
  });
});
