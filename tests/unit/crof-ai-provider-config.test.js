// Crof AI: OpenAI-compatible API-key provider with passthrough model IDs.
import { describe, it, expect } from "vitest";
import crofAi from "../../open-sse/providers/registry/crof-ai.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import registry from "../../open-sse/providers/registry/index.js";

describe("Crof AI registry entry", () => {
  it("is an API-key provider with passthrough models", () => {
    expect(crofAi.id).toBe("crof-ai");
    expect(crofAi.alias).toBe("crof");
    expect(crofAi.category).toBe("apikey");
    expect(crofAi.passthroughModels).toBe(true);
    expect(crofAi.serviceKinds).toEqual(["llm", "imageToText"]);
    expect(crofAi.display).toMatchObject({
      name: "Crof AI",
      website: "https://crof.ai",
      notice: { apiKeyUrl: "https://crof.ai/docs" },
    });
  });

  it("is registered, so the runtime actually sees it", () => {
    expect(registry.some((entry) => entry.id === "crof-ai")).toBe(true);
  });

  it("builds an OpenAI-format transport", () => {
    expect(PROVIDERS["crof-ai"]).toEqual({
      baseUrl: "https://crof.ai/v1/chat/completions",
      format: "openai",
    });
  });
});
