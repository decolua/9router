import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { exchangeTokens, getProvider } from "../../src/lib/oauth/providers.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";

const scopes = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
  "user:file_upload",
];

const profile = {
  account: {
    uuid: "account-uuid",
    email: "user@example.test",
    display_name: "User",
    has_claude_max: true,
    has_claude_pro: false,
  },
  organization: {
    uuid: "org-uuid",
    organization_type: "claude_max",
    rate_limit_tier: "default_claude_max_20x",
    subscription_status: "active",
  },
};

const proxyOptions = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  strictProxy: true,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Claude Code 2.1.220 OAuth", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses current endpoints, scopes, and authorize query", () => {
    const provider = getProvider("claude");
    const redirectUri = "http://localhost:20127/callback";
    const authUrl = new URL(provider.buildAuthUrl(
      provider.config,
      redirectUri,
      "oauth-state",
      "pkce-challenge",
    ));

    expect(provider.config.authorizeUrl).toBe("https://claude.com/cai/oauth/authorize");
    expect(provider.config.tokenUrl).toBe("https://platform.claude.com/v1/oauth/token");
    expect(provider.config.scopes).toEqual(scopes);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe(provider.config.authorizeUrl);
    expect([...authUrl.searchParams.keys()]).toEqual([
      "code",
      "client_id",
      "response_type",
      "redirect_uri",
      "scope",
      "code_challenge",
      "code_challenge_method",
      "state",
    ]);
    expect(Object.fromEntries(authUrl.searchParams)).toEqual({
      code: "true",
      client_id: provider.config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      code_challenge: "pkce-challenge",
      code_challenge_method: "S256",
      state: "oauth-state",
    });
  });

  it("fetches and maps approved profile identity through selected proxy", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: scopes.join(" "),
      }))
      .mockResolvedValueOnce(jsonResponse(profile));

    const result = await exchangeTokens(
      "claude",
      "authorization-code",
      "http://localhost:20127/callback",
      "pkce-verifier",
      "oauth-state",
      {},
      proxyOptions,
    );

    expect(fetchSpy.mock.calls[0][0]).toBe("https://platform.claude.com/v1/oauth/token");
    expect(fetchSpy.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
    expect(fetchSpy.mock.calls[1][0]).toBe("https://api.anthropic.com/api/oauth/profile");
    expect(fetchSpy.mock.calls[1][1].method ?? "GET").toBe("GET");
    expect(fetchSpy.mock.calls[1][1].headers).toEqual({
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    expect(fetchSpy.mock.calls[1][1].signal).toBe(timeoutSignal);
    expect(fetchSpy.mock.calls[1][1].proxyOptions).toBe(proxyOptions);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(result).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      email: "user@example.test",
      displayName: "User",
    });
    expect(result.providerSpecificData).toEqual({
      accountId: "account-uuid",
      organizationId: "org-uuid",
      organizationType: "claude_max",
      hasClaudeMax: true,
      hasClaudePro: false,
      rateLimitTier: "default_claude_max_20x",
      subscriptionStatus: "active",
    });
  });

  it("keeps token exchange successful when profile lookup fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      }))
      .mockRejectedValueOnce(new Error("synthetic profile failure"));

    await expect(exchangeTokens(
      "claude",
      "authorization-code",
      "http://localhost:20127/callback",
      "pkce-verifier",
      "oauth-state",
      {},
      proxyOptions,
    )).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe("https://api.anthropic.com/api/oauth/profile");
  });

  it("preserves private bare GitHub aliases", async () => {
    await expect(getModelInfoCore("claude-fable-5", {})).resolves.toEqual({
      provider: "github",
      model: "claude-fable-5",
    });
    await expect(getModelInfoCore("claude-opus-4.8", {})).resolves.toEqual({
      provider: "github",
      model: "claude-opus-4.8",
    });
  });
});

describe("Claude profile connection identity", () => {
  const originalDataDir = process.env.DATA_DIR;
  let dataDir;
  let db;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-claude-profile-"));
    process.env.DATA_DIR = dataDir;
    delete global._dbAdapter;
    vi.resetModules();
    db = await import("../../src/lib/db/index.js");
    await db.initDb();
  });

  afterAll(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch { /* best effort */ }
    delete global._dbAdapter;
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("prefers email, display name, account UUID prefix, then existing fallback", async () => {
    const email = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "email-token",
      email: "first@example.test",
      displayName: "First User",
      providerSpecificData: { accountId: "email-account" },
    });
    const duplicate = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "new-email-token",
      email: "first@example.test",
      providerSpecificData: { accountId: "email-account" },
    });
    const displayName = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "display-token",
      displayName: "Display User",
      providerSpecificData: { accountId: "display-account" },
    });
    const accountId = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "account-token",
      providerSpecificData: { accountId: "12345678-abcd-efgh" },
    });
    const fallback = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "fallback-token",
    });

    expect(email.name).toBe("first@example.test");
    expect(duplicate.id).toBe(email.id);
    expect(displayName.name).toBe("Display User");
    expect(accountId.name).toBe("12345678");
    expect(fallback.name).toBe("Account 4");
    await expect(db.getProviderConnections({ provider: "claude" })).resolves.toHaveLength(4);
  });

  it("deduplicates a Claude account UUID after its email changes", async () => {
    const original = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "stable-account-old-token",
      email: "stable-old@example.test",
      providerSpecificData: { accountId: "stable-account-id" },
    });
    const updated = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "stable-account-new-token",
      email: "stable-new@example.test",
      providerSpecificData: { accountId: "stable-account-id" },
    });

    expect(updated.id).toBe(original.id);
    expect(updated.email).toBe("stable-new@example.test");
    expect(updated.accessToken).toBe("stable-account-new-token");
  });

  it("keeps different Claude account UUIDs with one email separate", async () => {
    const first = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "shared-email-first-token",
      email: "shared@example.test",
      providerSpecificData: { accountId: "shared-email-account-one" },
    });
    const second = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "shared-email-second-token",
      email: "shared@example.test",
      providerSpecificData: { accountId: "shared-email-account-two" },
    });

    expect(second.id).not.toBe(first.id);
  });

  it("does not email-deduplicate Claude OAuth without an incoming account UUID", async () => {
    const identified = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "identified-token",
      email: "missing-id@example.test",
      providerSpecificData: { accountId: "identified-account-id" },
    });
    const unidentified = await db.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      accessToken: "unidentified-token",
      email: "missing-id@example.test",
    });

    expect(unidentified.id).not.toBe(identified.id);
    await expect(db.getProviderConnectionById(identified.id)).resolves.toMatchObject({
      accessToken: "identified-token",
      providerSpecificData: { accountId: "identified-account-id" },
    });
  });
});
