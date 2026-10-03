import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

describe("OpenAI multi-endpoint transports", () => {
  it("routes Responses API clients to /v1/responses", () => {
    expect(resolveTransport("openai", "openai-responses")).toMatchObject({
      format: "openai-responses",
      baseUrl: "https://api.openai.com/v1/responses",
    });
  });

  it("keeps Chat Completions clients on /v1/chat/completions", () => {
    expect(resolveTransport("openai", "openai")).toMatchObject({
      format: "openai",
      baseUrl: "https://api.openai.com/v1/chat/completions",
    });
  });

  it("preserves the existing default OpenAI transport", () => {
    expect(PROVIDERS.openai.baseUrl).toBe("https://api.openai.com/v1/chat/completions");
  });
});
