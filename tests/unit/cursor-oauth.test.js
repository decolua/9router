import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { CursorService } from "../../src/lib/oauth/services/cursor.js";

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

describe("Cursor OAuth service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generates the Cursor PKCE login URL without exposing the verifier", () => {
    const service = new CursorService();
    const auth = service.getAuthorizationData();
    const url = new URL(auth.authUrl);
    const expectedChallenge = crypto.createHash("sha256").update(auth.verifier).digest("base64url");

    expect(url.origin + url.pathname).toBe("https://cursor.com/loginDeepControl");
    expect(url.searchParams.get("uuid")).toBe(auth.uuid);
    expect(url.searchParams.get("challenge")).toBe(expectedChallenge);
    expect(url.searchParams.get("mode")).toBe("login");
    expect(url.searchParams.has("verifier")).toBe(false);
  });

  it("treats a 404 poll response as authorization pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not found", { status: 404 })));
    const result = await new CursorService().pollToken("flow-id", "verifier");

    expect(result).toEqual({ success: false, pending: true, error: "authorization_pending" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api2.cursor.sh/auth/poll?uuid=flow-id&verifier=verifier",
      expect.objectContaining({ headers: expect.objectContaining({ "x-cursor-client-type": "ide" }) }),
    );
  });

  it("maps successful polling tokens to renewable credentials", async () => {
    const accessToken = jwt({ sub: "auth0|user_123", email: "user@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ accessToken, refreshToken: "refresh-token" })));
    const service = new CursorService();
    const result = await service.pollToken("flow-id", "verifier");
    const credentials = service.mapTokens(result.tokens.accessToken, result.tokens.refreshToken);

    expect(credentials).toMatchObject({
      accessToken,
      refreshToken: "refresh-token",
      email: "user@example.com",
      providerSpecificData: { authMethod: "oauth", userId: "auth0|user_123" },
    });
    expect(credentials.expiresIn).toBeGreaterThan(3000);
    expect(credentials.providerSpecificData).not.toHaveProperty("machineId");
  });

  it("refreshes with Cursor's exchange endpoint and preserves an omitted refresh token", async () => {
    const accessToken = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ accessToken })));
    const credentials = await new CursorService().refreshToken("old-refresh-token");

    expect(fetch).toHaveBeenCalledWith(
      "https://api2.cursor.sh/auth/exchange_user_api_key",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer old-refresh-token" }),
        body: "{}",
      }),
    );
    expect(credentials.refreshToken).toBe("old-refresh-token");
    expect(credentials.accessToken).toBe(accessToken);
  });
});
