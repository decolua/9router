import { describe, it, expect } from "vitest";
import {
  ZED_PROVIDER,
  ZED_DEFAULT_PROVIDER,
  ZED_CLIENT_VERSION,
  resolveZedProvider,
} from "../../open-sse/config/zedConstants.js";
import { openaiToZedRequest } from "../../open-sse/translator/request/openai-to-zed.js";

describe("zedConstants wire protocol", () => {
  it("uses snake_case CompletionBody.provider tags (HTTP API contract)", () => {
    expect(ZED_PROVIDER).toEqual({
      anthropic: "anthropic",
      openai: "open_ai",
      google: "google",
      xai: "x_ai",
    });
    expect(ZED_DEFAULT_PROVIDER).toBe("open_ai");
  });

  it("maps catalog provider strings to wire tags", () => {
    expect(resolveZedProvider("anthropic", null)).toBe("anthropic");
    expect(resolveZedProvider("Anthropic", null)).toBe("anthropic");
    expect(resolveZedProvider("open_ai", null)).toBe("open_ai");
    expect(resolveZedProvider("OpenAi", null)).toBe("open_ai");
    expect(resolveZedProvider("google", null)).toBe("google");
    expect(resolveZedProvider("x_ai", null)).toBe("x_ai");
  });

  it("infers provider from model id when catalog omits provider", () => {
    expect(resolveZedProvider(null, "claude-sonnet-4-6")).toBe("anthropic");
    expect(resolveZedProvider(null, "gemini-2.5-flash")).toBe("google");
    expect(resolveZedProvider(null, "grok-3")).toBe("x_ai");
    expect(resolveZedProvider(null, "gpt-5-nano")).toBe("open_ai");
  });

  it("openai-to-zed emits snake_case provider in CompletionBody", () => {
    const body = openaiToZedRequest(
      "claude-sonnet-4-6",
      { messages: [{ role: "user", content: "hi" }] },
      true,
    );
    expect(body.provider).toBe("anthropic");
    expect(body.provider_request?.model).toBe("claude-sonnet-4-6");
    expect(body.thread_id).toBeTruthy();
    expect(body.prompt_id).toBeTruthy();
  });

  it("keeps a stable default x-zed-version", () => {
    expect(ZED_CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
