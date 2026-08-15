import { describe, it, expect } from "vitest";

import { stripUnsupportedParams, STRIP_RULES } from "../../open-sse/translator/concerns/paramSupport.js";

describe("stripUnsupportedParams", () => {
  it("truncates tools for providers with a truncateTools rule", () => {
    STRIP_RULES.push({ provider: "test-truncate", truncateTools: 5 });

    const body = {
      tools: Array.from({ length: 200 }, (_, i) => ({ type: "function", function: { name: `tool_${i}` } })),
      messages: [{ role: "user", content: "hi" }],
    };

    stripUnsupportedParams("test-truncate", "some-model", body);

    expect(body.tools).toHaveLength(5);

    STRIP_RULES.pop();
  });


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

  it("does not modify body for unknown provider", () => {
    const body = { tools: Array.from({ length: 200 }, (_, i) => ({ type: "function", function: { name: `tool_${i}` } })), messages: [{ role: "user", content: "hi" }] };

    stripUnsupportedParams("unknown-provider", "some-model", body);

    expect(body.tools).toHaveLength(200);
    expect(body.messages).toHaveLength(1);
  });
});
