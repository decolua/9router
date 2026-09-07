import { describe, expect, it } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_OAUTH, PROVIDER_MODELS } from "open-sse/providers/index.js";
import { buildDevinAuthUrl, exchangeDevinToken, parseDevinCallback } from "@/lib/oauth/providers/devin.js";

describe("Devin registry", () => {
  it("exposes OAuth metadata and static fallback models", () => {
    const entry = REGISTRY.find((item) => item.id === "devin");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("dv");
    expect(entry.category).toBe("oauth");
    expect(entry.authModes).toEqual(["oauth"]);
    expect(PROVIDER_OAUTH.devin.callbackPath).toBe("/callback");
    expect(PROVIDER_OAUTH.devin.callbackPort).toBe(59653);
    expect(PROVIDERS.devin.forceStream).toBe(true);
    expect(PROVIDER_MODELS.dv.map((model) => model.id)).toEqual(["swe-1-7", "swe-1-6"]);
  });
});

describe("Devin OAuth", () => {
  it("builds a stateful PKCE authorization URL", () => {
    const url = new URL(buildDevinAuthUrl(
      { authorizeUrl: "https://app.devin.ai/auth/cli/continue", codeChallengeMethod: "S256" },
      "http://127.0.0.1:59653/callback",
      "state-1",
      "challenge-1",
    ));
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:59653/callback");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("accepts a full pasted callback URL and validates state", () => {
    expect(parseDevinCallback(
      "http://127.0.0.1:59653/callback?code=abc&state=state-1",
      "state-1",
    )).toEqual({ code: "abc", state: "state-1" });
    expect(() => parseDevinCallback(
      "http://127.0.0.1:59653/callback?code=abc&state=wrong",
      "state-1",
    )).toThrow(/state/i);
  });

  it("exchanges the code as JSON and never creates a refresh token", async () => {
    const fetchImpl = async (_url, init) => {
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ code: "abc", code_verifier: "verifier" });
      return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
    };
    await expect(exchangeDevinToken({ tokenUrl: "https://api.devin.ai/auth/cli/token" }, "abc", "verifier", fetchImpl)).resolves.toEqual({
      accessToken: "session-token", refreshToken: null, expiresIn: null, expiresAt: null,
    });
  });
});
