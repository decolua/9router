import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { stripUnsupportedChatExtensions } from "../../open-sse/translator/concerns/paramSupport.js";

const KEY = "stable-cache-key";

const chatBody = () => ({
  model: "example-model",
  messages: [{ role: "user", content: "hello" }],
  prompt_cache_key: KEY,
});

const responsesBody = () => ({
  model: "example-model",
  input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
  prompt_cache_key: KEY,
});

describe("prompt_cache_key provider-boundary guard (Responses → Chat hop only)", () => {
  it("responses → chat keeps the key for a provider declaring preservePromptCacheKey (openai)", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-4o", responsesBody(), true, {}, "openai");

    expect(out.prompt_cache_key).toBe(KEY);
    expect(out.messages?.[0]?.role).toBe("user");
  });

  it("responses → chat strips the key for a provider without the quirk (groq)", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "llama-3.3-70b", responsesBody(), true, {}, "groq");

    expect(out.prompt_cache_key).toBeUndefined();
    expect(out.messages?.[0]?.role).toBe("user");
  });

  it("responses → chat strips the key for github until Copilot Chat Completions support is verified", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "gpt-5.4", responsesBody(), true, {}, "github");

    expect(out.prompt_cache_key).toBeUndefined();
    expect(out.messages?.[0]?.role).toBe("user");
  });

  it("chat → chat retains the key for a non-quirk provider", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "any", chatBody(), true, {}, "opencode");

    expect(out.prompt_cache_key).toBe(KEY);
  });

  it("chat → chat retains the key for openai-compatible-* nodes", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "any", chatBody(), true, {}, "openai-compatible-chat-abc");

    expect(out.prompt_cache_key).toBe(KEY);
  });

  it("leaves Responses-target bodies untouched regardless of provider", () => {
    const passthrough = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "any", responsesBody(), true, {}, "openai-compatible-custom");
    expect(passthrough.prompt_cache_key).toBe(KEY);

    const chatToResponses = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "any", chatBody(), true, {}, "groq");
    expect(chatToResponses.prompt_cache_key).toBe(KEY);
  });

  it("stripUnsupportedChatExtensions is fail-open on unknown provider and null/non-object bodies", () => {
    expect(stripUnsupportedChatExtensions("no-such-provider", null)).toBeNull();
    expect(stripUnsupportedChatExtensions(undefined, undefined)).toBeUndefined();
    expect(stripUnsupportedChatExtensions("groq", "text")).toBe("text");
    expect(() => stripUnsupportedChatExtensions("no-such-provider", { prompt_cache_key: KEY })).not.toThrow();
  });
});
