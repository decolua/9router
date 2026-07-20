// #2591 — Alibaba Intl (alicode-intl) must use the OpenAI-compatible-mode
// DashScope endpoint so standard DashScope API keys work. The previous
// coding-intl host only accepted Alibaba Coding Plan keys and rejected
// ordinary DashScope keys with "Invalid API key".
import { describe, it, expect } from "vitest";
import alicodeIntl from "../../open-sse/providers/registry/alicode-intl.js";

describe("alicode-intl endpoint (issue #2591)", () => {
  it("routes to the compatible-mode DashScope endpoint", () => {
    expect(alicodeIntl.id).toBe("alicode-intl");
    expect(alicodeIntl.transport.baseUrl).toBe(
      "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
  });

  it("does not use the coding-intl host that rejects standard keys", () => {
    expect(alicodeIntl.transport.baseUrl).not.toContain("coding-intl.dashscope.aliyuncs.com");
  });

  it("keeps the chat/completions path and preserveCacheControl quirk", () => {
    expect(alicodeIntl.transport.baseUrl).toContain("/v1/chat/completions");
    expect(alicodeIntl.transport.quirks.preserveCacheControl).toBe(true);
  });
});
