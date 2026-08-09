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

  it("drops reasoning_effort/reasoning for custom OpenAI-compatible providers (#3008)", () => {
    const body = { reasoning_effort: "medium", reasoning: { effort: "medium" }, temperature: 0.7 };

    stripUnsupportedParams("openai-compatible-responses-b7531984", "gpt-5.6-sol", body);

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
    expect(body.temperature).toBe(0.7); // unrelated param preserved
  });

  it("does NOT drop reasoning_effort for real reasoning providers", () => {
    const body = { reasoning_effort: "high", model: "deepseek-reasoner" };

    stripUnsupportedParams("deepseek", "deepseek-reasoner", body);

    expect(body.reasoning_effort).toBe("high"); // preserved for providers that support it
  });

  it("renames max_tokens → max_completion_tokens for OpenAI gpt-5.x (#2830)", () => {
    const body = { max_tokens: 4096, model: "gpt-5.6-luna" };

    stripUnsupportedParams("openai", "gpt-5.6-luna", body);

    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBe(4096);
  });

  it("does NOT rename for OpenAI gpt-4o (still uses max_tokens)", () => {
    const body = { max_tokens: 2048, model: "gpt-4o" };

    stripUnsupportedParams("openai", "gpt-4o", body);

    expect(body.max_tokens).toBe(2048);
    expect(body.max_completion_tokens).toBeUndefined();
  });
});
