import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";

const EXPECTED_PROVIDERS = [
  {
    id: "verboo-code",
    alias: "vc",
    name: "Verboo Code",
    baseUrl: "https://code.verboo.ai/router/v1/chat/completions",
    validateUrl: "https://code.verboo.ai/router/v1/models",
  },
  {
    id: "digital-ocean",
    alias: "do",
    name: "Digital Ocean",
    baseUrl: "https://inference.do-ai.run/v1/chat/completions",
    validateUrl: "https://inference.do-ai.run/v1/models",
  },
];

describe.each(EXPECTED_PROVIDERS)("$name provider", (expected) => {
  const entry = REGISTRY.find((provider) => provider.id === expected.id);

  it("is registered as an API-key provider", () => {
    expect(entry).toMatchObject({
      id: expected.id,
      alias: expected.alias,
      category: "apikey",
      authType: "apikey",
      authModes: ["apikey"],
      passthroughModels: true,
    });
    expect(APIKEY_PROVIDERS[expected.id]).toBeDefined();
    expect(AI_PROVIDERS[expected.id]).toMatchObject({
      name: expected.name,
      alias: expected.alias,
      passthroughModels: true,
      canDiscoverModels: true,
    });
  });

  it("uses the requested prefix and OpenAI-compatible endpoints", () => {
    expect(resolveProviderAlias(expected.alias)).toBe(expected.id);
    expect(parseModel(`${expected.alias}/example-model`)).toEqual({
      provider: expected.id,
      model: "example-model",
      isAlias: false,
      providerAlias: expected.alias,
    });
    expect(PROVIDERS[expected.id]).toMatchObject({
      baseUrl: expected.baseUrl,
      validateUrl: expected.validateUrl,
      format: "openai",
    });
    expect(PROVIDER_MODELS[expected.alias]).toEqual([]);
  });

  it("has a local provider logo", async () => {
    const logoPath = fileURLToPath(new URL(`../../public/providers/${expected.id}.png`, import.meta.url));
    expect(existsSync(logoPath)).toBe(true);
  });
});
