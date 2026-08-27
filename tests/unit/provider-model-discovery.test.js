import { describe, expect, it } from "vitest";

import { createRegistryModelsConfig } from "../../src/app/api/providers/[id]/models/route.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

describe("provider model discovery", () => {
  it("builds an authenticated /models request from the provider registry", () => {
    expect(createRegistryModelsConfig("verboo-code")).toMatchObject({
      url: "https://code.verboo.ai/router/v1/models",
      method: "GET",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
    });
    expect(createRegistryModelsConfig("digital-ocean")).toMatchObject({
      url: "https://inference.do-ai.run/v1/models",
      authHeader: "Authorization",
      authPrefix: "Bearer ",
    });
  });

  it("only exposes discovery for API-key providers with a /models endpoint", () => {
    expect(AI_PROVIDERS["verboo-code"].canDiscoverModels).toBe(true);
    expect(AI_PROVIDERS["digital-ocean"].canDiscoverModels).toBe(true);
    expect(AI_PROVIDERS.assemblyai.canDiscoverModels).toBeUndefined();
    expect(createRegistryModelsConfig("assemblyai")).toBeNull();
  });
});
