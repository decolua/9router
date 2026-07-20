import { describe, expect, it } from "vitest";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";
import {
  OAUTH_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "../../src/shared/constants/providers.js";

describe("CodeBuddy provider registry split", () => {
  it("exposes CodeBuddy and CodeBuddy CN as separate OAuth providers", () => {
    expect(OAUTH_PROVIDERS.codebuddy?.name).toMatch(/^CodeBuddy/);
    expect(OAUTH_PROVIDERS["codebuddy-cn"]?.name).toBe("CodeBuddy CN");
    expect(OAUTH_PROVIDERS.codebuddy?.authModes).toEqual(["oauth", "apikey"]);
    expect(OAUTH_PROVIDERS["codebuddy-cn"]?.authModes).toEqual(["oauth", "apikey"]);
  });

  it("keeps separate model aliases and default catalogs", () => {
    expect(PROVIDER_ID_TO_ALIAS.codebuddy).toBe("cb");
    expect(PROVIDER_ID_TO_ALIAS["codebuddy-cn"]).toBe("cbcn");
    expect(parseModel("cb/default-model")).toMatchObject({
      provider: "codebuddy",
      model: "default-model",
    });
    expect(parseModel("cbcn/glm-5.1")).toMatchObject({
      provider: "codebuddy-cn",
      model: "glm-5.1",
    });
    expect(getModelsByProviderId("codebuddy").map((model) => model.id)).toContain("default-model");
  });

  it("allows quota tracking for OAuth and generated API-key connections", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toEqual(expect.arrayContaining(["codebuddy", "codebuddy-cn"]));
    expect(USAGE_APIKEY_PROVIDERS).toEqual(expect.arrayContaining(["codebuddy", "codebuddy-cn"]));
  });
});
