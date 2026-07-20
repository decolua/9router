import { describe, it, expect, vi, afterEach } from "vitest";

import {
  buildDashboardAntigravityAuthData,
  exchangeAndSaveAntigravityConnection,
  buildLoopbackRedirectUri,
  createAntigravityAuthUrl,
} from "../../src/lib/oauth/services/antigravityBulkImportManager.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Antigravity bulk import OAuth URL", () => {
  it("uses the dashboard callback URL instead of a random loopback port", () => {
    expect(buildLoopbackRedirectUri()).toBe("http://localhost:20128/callback");
  });

  it("builds the same Google OAuth shape as the dashboard add-connection flow", () => {
    const authUrl = new URL(createAntigravityAuthUrl("http://localhost:20128/callback", "state-123"));

    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("client_id")).toBe("1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com");
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://localhost:20128/callback");
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("prompt")).toBe("consent");
    expect(authUrl.searchParams.get("state")).toBe("state-123");
  });

  it("requests the dashboard authorize endpoint used by add connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=from-dashboard",
        state: "from-dashboard",
      }),
    })));

    const data = await buildDashboardAntigravityAuthData("http://localhost:20128/callback");

    expect(data.state).toBe("from-dashboard");
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://localhost:20128/api/oauth/antigravity/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A20128%2Fcallback"),
      { cache: "no-store" },
    );
  });

  it("saves OAuth tokens even when loadCodeAssist returns no project", async () => {
    const saveConnection = vi.fn(async ({ projectId }) => ({ connection: { id: "conn-1", projectId } }));
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const raw = String(url);
      if (raw.includes("oauth2.googleapis.com") || raw.includes("/token")) {
        return { ok: true, json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "email" }) };
      }
      if (raw.includes("userinfo")) {
        return { ok: true, json: async () => ({ email: "user@example.com" }) };
      }
      if (raw.includes("loadCodeAssist")) {
        return { ok: true, json: async () => ({ allowedTiers: [{ id: "legacy-tier", isDefault: true }] }) };
      }
      throw new Error(`unexpected fetch ${raw}`);
    }));

    const result = await exchangeAndSaveAntigravityConnection({
      callback: { code: "code-1" },
      redirectUri: "http://localhost:20128/callback",
      email: "user@example.com",
      saveConnection,
    });

    expect(result.connection.id).toBe("conn-1");
    expect(saveConnection).toHaveBeenCalledWith(expect.objectContaining({ projectId: "" }));
  });
});
