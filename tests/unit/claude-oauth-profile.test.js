import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import claude from "../../src/lib/oauth/providers/claude.js";
import { claudeProfileFields } from "../../src/lib/oauth/providerHelpers.js";
import { claudePlanName } from "../../open-sse/services/usage/claude.js";
import { PROVIDER_OAUTH } from "../../open-sse/providers/index.js";

// Live shape of GET https://api.anthropic.com/api/oauth/profile
const PROFILE = {
  account: {
    uuid: "90158bdc-084b-47fa-970e-47c858a0a54d",
    full_name: "admin papaya",
    display_name: "admin papaya",
    email: "admin@papaya.asia",
    has_claude_max: true,
    has_claude_pro: false,
  },
  organization: {
    uuid: "1990e095-ff60-4841-babc-e46a00092d12",
    name: "admin@papaya.asia's Organization",
    organization_type: "claude_max",
    rate_limit_tier: "default_claude_max_20x",
  },
};

describe("claude OAuth profile (postExchange → mapTokens)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("registers the profile endpoint on the claude oauth config", () => {
    expect(PROVIDER_OAUTH.claude.profileUrl).toBe(
      "https://api.anthropic.com/api/oauth/profile"
    );
  });

  it("fetches the profile with the OAuth beta headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => PROFILE,
    });

    const extra = await claude.postExchange({ access_token: "oat-token" });
    expect(extra.profile).toEqual(PROFILE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/api/oauth/profile");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer oat-token");
    expect(init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("maps the profile onto email, displayName and providerSpecificData", () => {
    const mapped = claude.mapTokens(
      {
        access_token: "oat-token",
        refresh_token: "ort-token",
        expires_in: 3600,
        scope: "user:inference",
      },
      { profile: PROFILE }
    );

    expect(mapped).toEqual({
      accessToken: "oat-token",
      refreshToken: "ort-token",
      expiresIn: 3600,
      scope: "user:inference",
      email: "admin@papaya.asia",
      displayName: "admin papaya",
      providerSpecificData: {
        claudeAccountUuid: "90158bdc-084b-47fa-970e-47c858a0a54d",
        claudeHasMax: true,
        claudeHasPro: false,
        claudeOrgUuid: "1990e095-ff60-4841-babc-e46a00092d12",
        claudeOrgName: "admin@papaya.asia's Organization",
        claudeOrgType: "claude_max",
        claudeRateLimitTier: "default_claude_max_20x",
      },
    });
  });

  it("keeps the connect working when the profile endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 });

    const extra = await claude.postExchange({ access_token: "oat-token" });
    expect(extra).toEqual({ profile: null });

    expect(claude.mapTokens({ access_token: "oat-token" }, extra)).toEqual({
      accessToken: "oat-token",
      refreshToken: undefined,
      expiresIn: undefined,
      scope: undefined,
    });
  });

  it("swallows a network error instead of failing the exchange", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await expect(claude.postExchange({ access_token: "oat-token" })).resolves.toEqual({
      profile: null,
    });
  });

  it("derives no fields from an empty profile", () => {
    expect(claudeProfileFields(null)).toEqual({});
    expect(claudeProfileFields({})).toEqual({});
  });
});

describe("claude plan name (usage reply)", () => {
  it("reads the rate limit tier, multiplier included", () => {
    expect(claudePlanName({ claudeRateLimitTier: "default_claude_max_20x" })).toBe("Claude Max 20x");
    expect(claudePlanName({ claudeRateLimitTier: "default_claude_max_5x" })).toBe("Claude Max 5x");
    expect(claudePlanName({ claudeRateLimitTier: "default_claude_pro" })).toBe("Claude Pro");
  });

  it("falls back to the organization type, then the account flags", () => {
    expect(claudePlanName({ claudeOrgType: "claude_max" })).toBe("Claude Max");
    expect(claudePlanName({ claudeHasPro: true })).toBe("Claude Pro");
  });

  it("keeps the historical literal when nothing is known", () => {
    expect(claudePlanName(undefined)).toBe("Claude Code");
    expect(claudePlanName({})).toBe("Claude Code");
  });
});
