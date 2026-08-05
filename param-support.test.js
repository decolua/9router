import { describe, it, expect } from "vitest";

import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("flattens Cloudflare AI OpenAI content-part arrays", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hello " },
            { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
            { type: "text", text: "world" },
          ],
        },
      ],
    };

    expect(() => stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3.1-8b-instruct", body)).not.toThrow();
    expect(body.messages[0].content).toBe("hello world");
  });

  it("still drops unsupported GitHub model params", () => {
    const body = { temperature: 0.7, top_p: 1 };

    stripUnsupportedParams("github", "gpt-5.4", body);

    expect(body).toEqual({ top_p: 1 });
  });

  it("clamps VolcEngine Ark GLM max token fields to the model output ceiling", () => {
    const body = {
      max_tokens: 131072,
      max_completion_tokens: 131072,
      max_output_tokens: 131072,
    };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body).toEqual({
      max_tokens: 128000,
      max_completion_tokens: 128000,
      max_output_tokens: 128000,
    });
  });

  it("keeps VolcEngine Ark GLM max tokens when already under the ceiling", () => {
    const body = { max_tokens: 64000 };

    stripUnsupportedParams("volcengine-ark", "GLM-5.2", body);

    expect(body.max_tokens).toBe(64000);
  });

  it("renames max_tokens to max_completion_tokens for OpenAI gpt-5 models", () => {
    const body = { max_tokens: 8192, temperature: 0.7 };

    stripUnsupportedParams("openai", "gpt-5.1", body);

    expect(body).toEqual({ max_completion_tokens: 8192, temperature: 0.7 });
  });

  it("renames max_tokens for o-series reasoning models", () => {
    const body = { max_tokens: 4096 };

    stripUnsupportedParams("openai", "o3-mini", body);

    expect(body).toEqual({ max_completion_tokens: 4096 });
  });

  it("renames max_tokens for prefixed reseller model ids", () => {
    const body = { max_tokens: 1000 };

    stripUnsupportedParams("openrouter", "openai/gpt-5.1", body);

    expect(body).toEqual({ max_completion_tokens: 1000 });
  });

  it("keeps an already-present max_completion_tokens and drops max_tokens", () => {
    const body = { max_tokens: 1000, max_completion_tokens: 5000 };

    stripUnsupportedParams("openai", "gpt-5.1", body);

    expect(body).toEqual({ max_completion_tokens: 5000 });
  });

  it("leaves max_tokens alone for models that still support it", () => {
    const body = { max_tokens: 4096 };

    stripUnsupportedParams("openai", "gpt-4o", body);

    expect(body).toEqual({ max_tokens: 4096 });
  });
});
