import { describe, expect, it } from "vitest";

import { resolveChatStreamMode } from "../../open-sse/handlers/chatCore.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("chat stream mode", () => {
  it("keeps Claude /v1/messages JSON by default (#1396)", () => {
    const mode = resolveChatStreamMode({
      body: { model: "opus", messages: [{ role: "user", content: "say hi" }] },
      sourceFormat: FORMATS.CLAUDE,
      provider: "glm",
      clientHeaders: { "content-type": "application/json" },
    });

    expect(mode.stream).toBe(false);
    expect(mode.clientRequestedStreaming).toBe(false);
  });

  it("streams Claude /v1/messages when the body explicitly asks for it", () => {
    const mode = resolveChatStreamMode({
      body: { stream: true, messages: [{ role: "user", content: "say hi" }] },
      sourceFormat: FORMATS.CLAUDE,
      provider: "glm",
    });

    expect(mode.stream).toBe(true);
    expect(mode.clientRequestedStreaming).toBe(true);
  });

  it("streams Claude /v1/messages when the client accepts SSE", () => {
    const mode = resolveChatStreamMode({
      body: { messages: [{ role: "user", content: "say hi" }] },
      sourceFormat: FORMATS.CLAUDE,
      provider: "glm",
      clientHeaders: { Accept: "text/event-stream" },
    });

    expect(mode.stream).toBe(true);
    expect(mode.clientRequestedStreaming).toBe(true);
  });

  it("uses a non-streaming provider request when JSON is explicitly preferred", () => {
    const mode = resolveChatStreamMode({
      body: { messages: [{ role: "user", content: "say hi" }] },
      sourceFormat: FORMATS.OPENAI,
      provider: "openai",
      clientHeaders: { Accept: "application/json" },
    });

    expect(mode.stream).toBe(false);
    expect(mode.clientRequestedStreaming).toBe(false);
    expect(mode.providerRequiresStreaming).toBe(true);
  });
});
