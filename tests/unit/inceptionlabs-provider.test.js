import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Inception Labs provider", () => {
  const entry = REGISTRY.find((e) => e.id === "inceptionlabs");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("inceptionlabs");
    expect(entry.aliases).toContain("inception");
  });

  it("points at the Chat Completions endpoint", () => {
    expect(PROVIDERS.inceptionlabs.baseUrl).toBe("https://api.inceptionlabs.ai/v1/chat/completions");
    expect(PROVIDERS.inceptionlabs.format).toBe("openai");
  });

  it("does not declare /v1/models as validateUrl", () => {
    // Inception's /v1/models is public and returns 200 for any key, so using it
    // to validate would accept invalid keys. Validation uses a chat probe.
    expect(PROVIDERS.inceptionlabs.validateUrl).toBeUndefined();
  });

  it("lists only the chat models", () => {
    const ids = (PROVIDER_MODELS.inceptionlabs || []).map((m) => m.id);
    expect(ids).toEqual(["mercury-2.5", "mercury-2"]);
    // mercury-edit-2 is FIM/edit only, not served on /chat/completions
    expect(ids).not.toContain("mercury-edit-2");
  });

  it("fetches the live model list from the OpenAI-shaped /v1/models", () => {
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://api.inceptionlabs.ai/v1/models",
      type: "openai",
    });
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("inceptionlabs")).toBeInstanceOf(DefaultExecutor);
  });

  it("keeps every registry id unique after adding inceptionlabs", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
