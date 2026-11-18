import { describe, expect, it } from "vitest";
import { toProviderConnectionResponse } from "../../src/lib/providerConnectionResponse.js";

describe("GLM provider API response", () => {
  it("keeps plan metadata but strips all stored ZCode/Z.ai tokens", () => {
    const response = toProviderConnectionResponse({
      id: "glm-1",
      provider: "glm",
      authType: "oauth",
      accessToken: "plan-key",
      refreshToken: null,
      providerSpecificData: {
        plan: "start-plan",
        username: "Feavy",
        zcodeJwtToken: "zcode-jwt",
        zaiBusinessToken: "business-jwt",
        zaiRefreshToken: "refresh-token",
        individualCodingPlanApiKey: "individual-key",
        teamCodingPlanApiKey: "team-key",
        _captchaVerifyParam: "captcha-token",
      },
    });

    expect(response).not.toHaveProperty("accessToken");
    expect(response.providerSpecificData).toEqual({ plan: "start-plan", username: "Feavy" });
  });
});