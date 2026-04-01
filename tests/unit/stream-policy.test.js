import { describe, it, expect } from "vitest";
import { shouldForceNonStreamingForResponsesTool } from "../../open-sse/handlers/chatCore/streamPolicy.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("stream policy", () => {
  it("forces non-streaming for OpenAI Responses format", () => {
    expect(shouldForceNonStreamingForResponsesTool(FORMATS.OPENAI_RESPONSES, "/v1/chat/completions")).toBe(true);
  });

  it("forces non-streaming for /v1/responses endpoint", () => {
    expect(shouldForceNonStreamingForResponsesTool(FORMATS.OPENAI, "/v1/responses")).toBe(true);
  });

  it("does not force non-streaming for other formats/endpoints", () => {
    expect(shouldForceNonStreamingForResponsesTool(FORMATS.OPENAI, "/v1/chat/completions")).toBe(false);
  });

  it("does not force non-streaming when endpoint is not provided", () => {
    expect(shouldForceNonStreamingForResponsesTool(FORMATS.OPENAI)).toBe(false);
  });

  it("normalizes endpoint path before matching", () => {
    expect(shouldForceNonStreamingForResponsesTool(FORMATS.OPENAI, "///v1//responses///?x=1")).toBe(true);
  });
});
