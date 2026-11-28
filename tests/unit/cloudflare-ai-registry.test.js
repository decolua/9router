import { describe, expect, it } from "vitest";

import cloudflareAi from "../../open-sse/providers/registry/cloudflare-ai.js";

describe("cloudflare-ai registry model seeds (#5735)", () => {
  it("does not include models deprecated on 2026-11-20", () => {
    const modelIds = cloudflareAi.models.map((m) => m.id);
    const deprecated = [
      "@cf/meta/llama-3.2-1b-instruct",
      "@cf/meta/llama-3.2-3b-instruct",
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      "@cf/qwen/qwq-32b",
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      "@cf/moonshotai/kimi-k2.6",
      "@cf/bytedance/stable-diffusion-xl-lightning",
      "@cf/lykon/dreamshaper-8-lcm",
      "@cf/runwayml/stable-diffusion-v1-5-inpainting",
      "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    ];

    for (const depId of deprecated) {
      expect(modelIds).not.toContain(depId);
    }
  });

  it("does not include ids absent from the live catalog", () => {
    const modelIds = cloudflareAi.models.map((m) => m.id);

    expect(modelIds).not.toContain("@cf/meta/llama-3.1-8b-instruct-fp8-fast");
    expect(modelIds).not.toContain("@cf/meta/llama-3.1-70b-instruct-fp8-fast");
    expect(modelIds).not.toContain("@cf/runwayml/stable-diffusion-v1-5-img2img");
  });

  it("includes recommended active replacement models", () => {
    const modelIds = cloudflareAi.models.map((m) => m.id);
    const expectedActive = [
      "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/qwen/qwen3.8-27b",
      "@cf/zai-org/glm-5.3",
      "@cf/openai/gpt-oss-120b",
      "@cf/openai/gpt-oss-20b",
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    ];

    for (const expId of expectedActive) {
      expect(modelIds).toContain(expId);
    }
  });

  it("gives every model a valid ID starting with @cf/ and a display name", () => {
    for (const m of cloudflareAi.models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.startsWith("@cf/")).toBe(true);
      expect(typeof m.name).toBe("string");
      expect(m.name.length).toBeGreaterThan(0);
    }
  });

  it("preserves transport configuration and provider identity", () => {
    expect(cloudflareAi.id).toBe("cloudflare-ai");
    expect(cloudflareAi.transport.baseUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions"
    );
    expect(cloudflareAi.serviceKinds).toEqual(["llm", "image", "systemone"]);
  });
});
