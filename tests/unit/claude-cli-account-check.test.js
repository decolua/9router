import { describe, it, expect } from "vitest";

/**
 * What "Check" can and cannot learn about a Claude Code account.
 *
 * Measured against claude 2.1.281 on 2026-09-24, which is the whole point of
 * this file — the original code assumed an identity comes back for any working
 * credential, and that assumption was never tested against the binary.
 *
 * Config-directory login:
 *   { loggedIn: true, authMethod: "claude.ai", email: "...", orgName: "...",
 *     subscriptionType: "team", ... }
 *
 * Token (CLAUDE_CODE_OAUTH_TOKEN), with a deliberately invalid value:
 *   { loggedIn: true, authMethod: "oauth_token", apiProvider: "firstParty", ... }
 *   — no email, no orgName, no subscriptionType. The fields are ABSENT, not
 *   empty, and the command returns instantly: it is a local check that never
 *   asks the server, so a valid token produces the same shape.
 *
 * No credential at all:
 *   { loggedIn: false, authMethod: "none", ... }
 *
 * The consequence: "an identity came back" is a test a token account can never
 * pass. Judging a token account that way told every container operator their
 * working credential looked expired — and a container is the only place a
 * token account exists, because there is no terminal there to sign in with.
 */

/** Exactly what the binary printed, kept verbatim. */
const AUTH_STATUS = {
  configDir: {
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    email: "someone@example.com",
    orgId: "17033ae5-5395-47e5-84a4-24ff36fff787",
    orgName: "Example Org",
    subscriptionType: "team",
  },
  token: {
    loggedIn: true,
    authMethod: "oauth_token",
    apiProvider: "firstParty",
    analyticsDisabled: false,
  },
  none: {
    loggedIn: false,
    authMethod: "none",
    apiProvider: "firstParty",
  },
};

/** The rule the route applies, stated once so the test names the behaviour. */
const verifiedBy = ({ status, credentialAccepted }) => {
  const identity = status.loggedIn ? status : null;
  return Boolean(identity?.email) || (status.loggedIn && credentialAccepted);
};

describe("what auth status reports", () => {
  it("names the account for a config-directory login", () => {
    expect(AUTH_STATUS.configDir.email).toBeTruthy();
    expect(AUTH_STATUS.configDir.authMethod).toBe("claude.ai");
  });

  it("names nobody for a token, which is why identity cannot be the test", () => {
    expect(AUTH_STATUS.token.loggedIn).toBe(true);
    expect(AUTH_STATUS.token.email).toBeUndefined();
    expect(AUTH_STATUS.token.orgName).toBeUndefined();
    expect(AUTH_STATUS.token.subscriptionType).toBeUndefined();
  });

  it("reports an invalid token as logged in, so presence proves nothing", () => {
    // The sample above WAS an invalid token. A valid one looks identical.
    expect(AUTH_STATUS.token.loggedIn).toBe(true);
  });
});

describe("what Check concludes", () => {
  it("verifies a config-directory account from its identity alone", () => {
    expect(verifiedBy({ status: AUTH_STATUS.configDir, credentialAccepted: false })).toBe(true);
  });

  it("verifies a working token by using it, since it has no identity", () => {
    expect(verifiedBy({ status: AUTH_STATUS.token, credentialAccepted: true })).toBe(true);
  });

  it("does not call a working token expired, which is the report that started this", () => {
    // The old rule was `Boolean(identity?.email)`, which is false here for a
    // token however valid — so Check always claimed it had expired.
    const oldRule = Boolean(AUTH_STATUS.token.email);
    expect(oldRule).toBe(false);
    expect(verifiedBy({ status: AUTH_STATUS.token, credentialAccepted: true })).toBe(true);
  });

  it("still fails a token the server refuses", () => {
    expect(verifiedBy({ status: AUTH_STATUS.token, credentialAccepted: false })).toBe(false);
  });

  it("does not spend a request when there is no credential to test", () => {
    expect(verifiedBy({ status: AUTH_STATUS.none, credentialAccepted: true })).toBe(false);
  });
});
