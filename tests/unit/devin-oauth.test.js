import { describe, expect, it } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "open-sse/providers/index.js";

describe("Devin registry", () => {
  it("exposes OAuth metadata and static fallback models", () => {
    const entry = REGISTRY.find((item) => item.id === "devin");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("dv");
    expect(entry.category).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth"]);
    expect(PROVIDER_OAUTH.devin.callbackPath).toBe("/devin-auth-callback");
    expect(PROVIDERS.devin.forceStream).toBe(true);
    expect(PROVIDER_MODELS.dv.map((model) => model.id)).toEqual(["swe-1-7", "swe-1-6"]);
  });
});
