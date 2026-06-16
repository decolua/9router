import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

describe("glm model mapping", () => {
  it("maps glm-5.2 to GLM-5.2 upstream id", () => {
    expect(getModelUpstreamId("glm", "glm-5.2")).toBe("GLM-5.2");
  });

  it("maps glm-5-turbo to GLM-5-Turbo upstream id", () => {
    expect(getModelUpstreamId("glm", "glm-5-turbo")).toBe("GLM-5-Turbo");
  });
});

describe("glm/token-refresh wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("../../src/lib/zcode/oauth.js");
    vi.resetModules();
  });

  it("refreshTokenByProvider returns null when refreshToken missing", async () => {
    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = await mod.refreshTokenByProvider("glm", { refreshToken: "" }, null);
    expect(out).toBeNull();
  });

  it("refreshTokenByProvider returns refreshed glm credentials", async () => {
    vi.doMock("../../src/lib/zcode/oauth.js", () => ({
      refreshGlmOAuthCredentials: vi.fn(async () => ({
        accessToken: "new-jwt",
        apiKey: "key.secret",
        refreshToken: "rotated-refresh",
        expiresIn: 3600,
        providerSpecificData: { zcodeJwtToken: "new-jwt", zaiAccessToken: "new-zai" },
      })),
    }));

    const mod = await import("../../open-sse/services/tokenRefresh.js");
    const out = await mod.refreshTokenByProvider(
      "glm",
      { refreshToken: "old-refresh", providerSpecificData: { zcodeJwtToken: "jwt" } },
      null
    );

    expect(out).toMatchObject({
      accessToken: "new-jwt",
      apiKey: "key.secret",
      refreshToken: "rotated-refresh",
      expiresIn: 3600,
    });
  });
});