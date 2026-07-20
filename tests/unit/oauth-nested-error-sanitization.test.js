import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}));

const originalFetch = globalThis.fetch;

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("nested OAuth error sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it.each(["gemini-cli", "antigravity"])("sanitizes %s post-exchange log errors", async (provider) => {
    const secret = "https://user:password@provider.test/project?code=SECRET-CODE&access_token=SECRET-TOKEN";
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({ email: "user@example.com" }))
      .mockRejectedValueOnce(new Error(secret));
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");

    await exchangeTokens(
      provider,
      "authorization-code",
      "http://localhost:20127/callback",
      "code-verifier",
      "oauth-state",
      undefined,
      { disableEnvProxy: true },
    );

    const output = logged.mock.calls.flat().map(String).join(" ");
    for (const value of ["user", "password", "SECRET-CODE", "SECRET-TOKEN"]) {
      expect(output).not.toContain(value);
    }
  });
});
