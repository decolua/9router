import { describe, expect, it } from "vitest";
import {
  classifyOAuthProbeResult,
  isOAuthAuthenticationFailure,
} from "../../src/app/api/providers/[id]/test/testUtils.js";

const XAI_PROBE = {
  refreshOn403BadCredentials: true,
  errorFromBody: true,
};

describe("xAI OAuth connection probe", () => {
  it("treats xAI's 403 bad-credentials response as refreshable auth failure", () => {
    const body = JSON.stringify({
      code: "unauthenticated:bad-credentials",
      error: "The OAuth2 access token could not be validated.",
    });

    expect(isOAuthAuthenticationFailure({ status: 403 }, XAI_PROBE, body)).toBe(true);
  });

  it("does not refresh an unrelated xAI 403 response", () => {
    const body = JSON.stringify({ error: { message: "Insufficient credits" } });

    expect(isOAuthAuthenticationFailure({ status: 403 }, XAI_PROBE, body)).toBe(false);
  });

  it("surfaces the provider's xAI error message", () => {
    const body = JSON.stringify({
      error: { message: "The OAuth2 access token could not be validated." },
    });

    expect(classifyOAuthProbeResult({ ok: false, status: 403 }, XAI_PROBE, body)).toEqual({
      valid: false,
      error: "The OAuth2 access token could not be validated.",
      soft: false,
    });
  });
});
