import { describe, expect, it } from "vitest";
import { resolveTransport } from "../../open-sse/services/provider.js";

describe("kimi apikey transport selection (#2881)", () => {
  it("selects the platform endpoint for apikey auth", () => {
    const t = resolveTransport("kimi", "openai-apikey");
    expect(t.baseUrl).toBe("https://api.moonshot.cn/v1/chat/completions");
  });

  it("keeps the Kimi Code subscription endpoint for OAuth", () => {
    const t = resolveTransport("kimi", "openai");
    expect(t.baseUrl).toBe("https://api.kimi.com/coding/v1/chat/completions");
  });

  it("routes claude-format clients to the OpenAI platform endpoint (Moonshot is OpenAI-only)", () => {
    // A Claude-format client (sourceFormat 'claude') must NOT get a claude-format
    // transport — the platform API is OpenAI-compatible only (#2881).
    expect(resolveTransport("kimi", "openai-apikey").baseUrl).toBe("https://api.moonshot.cn/v1/chat/completions");
  });

  it("returns null when no apikey transport matches a non-kimi provider", () => {
    const t = resolveTransport("anthropic", "openai-apikey");
    expect(t).toBeNull();
  });
});
