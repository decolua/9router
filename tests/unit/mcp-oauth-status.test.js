import { describe, it, expect } from "vitest";
import { deriveOauthStatus } from "@/lib/mcp/gateway/oauthStatus";

describe("deriveOauthStatus", () => {
  it("returns 'none' when oauth is false, regardless of tokens", () => {
    expect(deriveOauthStatus(false, null)).toBe("none");
    expect(deriveOauthStatus(false, { access_token: "abc" })).toBe("none");
    expect(deriveOauthStatus(false, undefined)).toBe("none");
  });

  it("returns 'needs_login' when oauth is true but tokens are absent", () => {
    expect(deriveOauthStatus(true, null)).toBe("needs_login");
    expect(deriveOauthStatus(true, undefined)).toBe("needs_login");
  });

  it("returns 'needs_login' when needsReauth is true even with a valid access_token", () => {
    expect(
      deriveOauthStatus(true, { access_token: "abc", needsReauth: true })
    ).toBe("needs_login");
  });

  it("returns 'connected' for a valid access_token with no expiry", () => {
    expect(deriveOauthStatus(true, { access_token: "abc" })).toBe("connected");
  });

  it("returns 'connected' when expired but a refresh_token exists", () => {
    const past = Date.now() - 1000;
    expect(
      deriveOauthStatus(true, {
        access_token: "abc",
        expires_at: past,
        refresh_token: "r",
      })
    ).toBe("connected");
  });

  it("returns 'needs_login' when expired with no refresh_token", () => {
    const past = Date.now() - 1000;
    expect(
      deriveOauthStatus(true, { access_token: "abc", expires_at: past })
    ).toBe("needs_login");
  });
});
