import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

const MODEL_IDS = [
  "Qwen3.5-122B-A10B",
  "Gemma-4-26B-A4B-IT",
  "DeepSeek-V4-Flash",
  "GLM-5.2",
  "GLM-5.1",
  "Kimi-K2.6",
  "Kimi-K2.5",
  "Nube-Choice",
];

describe("Nube.sh provider", () => {
  const nube = REGISTRY.find((e) => e.id === "nube-sh");

  it("is registered as an OpenAI-compatible API key provider", () => {
    expect(nube).toBeDefined();
    expect(nube.category).toBe("apikey");
    expect(nube.display.name).toBe("Nube.sh");
    expect(nube.display.website).toBe("https://nube.sh");
    expect(nube.transport.baseUrl).toBe("https://ai.nube.sh/api/v1/chat/completions");
    expect(nube.transport.validateUrl).toBe("https://ai.nube.sh/api/v1/models");
  });

  it("exposes the requested model list", () => {
    expect(nube.models.map((m) => m.id)).toEqual(MODEL_IDS);
    expect((PROVIDER_MODELS.nube || []).map((m) => m.id)).toEqual(MODEL_IDS);
  });

  it("builds into the runtime provider map with the OpenAI format default", () => {
    expect(PROVIDERS["nube-sh"]).toMatchObject({
      format: "openai",
      baseUrl: "https://ai.nube.sh/api/v1/chat/completions",
    });
  });

  it("includes the Nube.sh favicon asset", () => {
    expect(existsSync(resolve(import.meta.dirname, "../../public/providers/nube-sh.png"))).toBe(true);
  });
});
