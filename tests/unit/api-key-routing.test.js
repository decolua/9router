import { describe, expect, it } from "vitest";
import {
  applyApiKeyRouting,
  isApiKeyModelVisible,
} from "../../src/lib/apiKeyPermissions.js";

describe("API key forced routing", () => {
  it("supplies an exact forced model when the client omits model", () => {
    const permissions = { forceModel: "local/model-a" };
    expect(applyApiKeyRouting(permissions, undefined)).toBe("local/model-a");
  });

  it("does not invent a model for a provider-only override", () => {
    const permissions = { forceProviderId: "local-node" };
    expect(applyApiKeyRouting(permissions, undefined)).toBeUndefined();
  });
});

describe("API key model catalogue", () => {
  it("publishes only the exact forced model", () => {
    const permissions = { forceModel: "local/model-a" };
    expect(isApiKeyModelVisible(permissions, {
      publicModelId: "local/model-a", provider: "local-node", model: "model-a",
    })).toBe(true);
    expect(isApiKeyModelVisible(permissions, {
      publicModelId: "other/model-b", provider: "other-node", model: "model-b",
    })).toBe(false);
  });

  it("limits a forced provider to that provider", () => {
    const permissions = { forceProviderId: "local-node" };
    expect(isApiKeyModelVisible(permissions, {
      publicModelId: "local/model-a", provider: "local-node", model: "model-a",
    })).toBe(true);
    expect(isApiKeyModelVisible(permissions, {
      publicModelId: "other/model-b", provider: "other-node", model: "model-b",
    })).toBe(false);
  });
});
