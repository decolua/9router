import { describe, expect, it } from "vitest";
import { getProviderNames } from "../../src/lib/oauth/providers.js";

describe("OAuth provider registry", () => {
  it("keeps Qoder while excluding the retired Qwen OAuth flow", () => {
    expect(getProviderNames()).toContain("qoder");
    expect(getProviderNames()).not.toContain("qwen");
  });
});
