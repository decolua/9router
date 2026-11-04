import { describe, expect, it } from "vitest";
import claude from "../../src/lib/oauth/providers/claude.js";

describe("Claude OAuth identity mapping", () => {
  it("maps account email and IDs from the token response", () => {
    const mapped = claude.mapTokens({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      scope: "user:profile",
      account: { uuid: "account-uuid", email_address: "dev@example.com" },
      organization: { uuid: "org-uuid" },
    });

    expect(mapped).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      scope: "user:profile",
      email: "dev@example.com",
      providerSpecificData: {
        claudeAccountId: "account-uuid",
        organizationUuid: "org-uuid",
      },
    });
  });

  it("accepts the older account.email field and omits empty metadata", () => {
    const mapped = claude.mapTokens({
      access_token: "access",
      account: { email: "old@example.com" },
    });

    expect(mapped.email).toBe("old@example.com");
    expect(mapped.providerSpecificData).toBeUndefined();
  });
});
