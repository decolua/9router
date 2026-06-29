import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

/**
 * Regression tests for Kiro API-key auth.
 *
 * KiroService.validateApiKey resolves a profileArn with the key (via
 * CodeWhisperer ListAvailableProfiles) and returns a credential shaped for
 * persistence with authMethod="api_key". The response profile field name
 * varies (`arn` vs `profileArn`) — both are accepted by listAvailableProfiles.
 *
 * Note: OAuth (Builder ID / IDC) profileArn resolution is handled upstream by
 * fetchKiroProfileArn in providers.js and is covered there — not here.
 */
describe("kiro API-key auth (KiroService.validateApiKey)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("validates an API key and resolves a credential with profileArn", async () => {
    const expectedArn = "arn:aws:codewhisperer:us-east-1:444:profile/KEY";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ profiles: [{ arn: expectedArn }] }),
    });

    const svc = new KiroService();
    const cred = await svc.validateApiKey("  my-secret-key  ");

    expect(cred).toEqual({
      accessToken: "my-secret-key",
      refreshToken: null,
      profileArn: expectedArn,
      region: "us-east-1",
      authMethod: "api_key",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://codewhisperer.us-east-1.amazonaws.com");
    expect(init.headers.Authorization).toBe("Bearer my-secret-key");
    expect(init.headers["x-amz-target"]).toBe(
      "AmazonCodeWhispererService.ListAvailableProfiles"
    );
  });

  it("rejects an empty API key without a network call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const svc = new KiroService();
    await expect(svc.validateApiKey("   ")).rejects.toThrow("API key is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a validation error when the key is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const svc = new KiroService();
    await expect(svc.validateApiKey("bad-key")).rejects.toThrow(
      /API key validation failed/
    );
  });
});
