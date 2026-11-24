import { describe, expect, it } from "vitest";
import { resolveStream } from "../../open-sse/handlers/chatCore/streamMode.js";

const decide = (body, extra = {}) =>
  resolveStream({ body, clientRequestedStreaming: body.stream === true, providerRequiresStreaming: false, ...extra });

describe("#5677 resolveStream", () => {
  it("treats absent stream as false for OpenAI/Claude-style clients", () => {
    expect(decide({})).toBe(false);
    expect(decide({ stream: undefined })).toBe(false);
    expect(decide({ stream: null })).toBe(false);
  });
  it("honours explicit values", () => {
    expect(decide({ stream: true })).toBe(true);
    expect(decide({ stream: false })).toBe(false);
  });
  it("streams absent-stream requests from Gemini-style source formats", () => {
    expect(decide({}, { clientRequestedStreaming: true })).toBe(true);
  });
  it("forceStream providers always stream", () => {
    expect(decide({ stream: false }, { providerRequiresStreaming: true })).toBe(true);
    expect(decide({}, { providerRequiresStreaming: true })).toBe(true);
  });
});
