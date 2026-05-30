import { describe, expect, it } from "vitest";

import { PROVIDERS } from "open-sse/config/providers.js";
import { APIKEY_PROVIDERS } from "@/shared/constants/providers.js";
import { PROVIDER_ENDPOINTS } from "@/shared/constants/config.js";
import { isValidModel } from "@/shared/constants/models.js";

describe("Crof AI provider config", () => {
  it("registers Crof AI as an OpenAI-compatible API-key provider", () => {
    expect(APIKEY_PROVIDERS["crof-ai"]).toMatchObject({
      id: "crof-ai",
      alias: "crof",
      name: "Crof AI",
      website: "https://crof.ai",
      notice: { apiKeyUrl: "https://crof.ai/docs" },
      passthroughModels: true,
      serviceKinds: ["llm", "imageToText"],
    });

    expect(PROVIDERS["crof-ai"]).toEqual({
      baseUrl: "https://crof.ai/v1/chat/completions",
      format: "openai",
    });

    expect(PROVIDER_ENDPOINTS["crof-ai"]).toBe("https://crof.ai/v1/chat/completions");
    expect(isValidModel("crof-ai", "kimi-k2.5")).toBe(true);
  });
});
