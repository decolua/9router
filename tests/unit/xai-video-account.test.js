import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));

const { getProviderCredentials } = await import("@/sse/services/auth.js");
const { checkAndRefreshToken, updateProviderCredentials } = await import(
  "@/sse/services/tokenRefresh.js"
);
const { persistXaiAccount, resolveXaiAccount } = await import(
  "@/app/api/v1/videos/_xaiAccount.js"
);

describe("xAI video account helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the saved xAI connection instead of the gateway Authorization bearer", async () => {
    const connection = {
      connectionId: "conn-xai",
      authType: "oauth",
      accessToken: "stored-access",
      refreshToken: "stored-refresh",
      expiresAt: "2026-05-20T00:10:00.000Z",
    };

    getProviderCredentials.mockResolvedValue(connection);
    checkAndRefreshToken.mockResolvedValue({
      ...connection,
      accessToken: "fresh-access",
    });

    const request = new Request("http://localhost:20128/v1/videos/generations", {
      headers: {
        Authorization: "Bearer gateway-api-key",
        "x-connection-id": "conn-xai",
      },
    });

    const account = await resolveXaiAccount(request);

    expect(getProviderCredentials).toHaveBeenCalledWith("xai", null, null, {
      preferredConnectionId: "conn-xai",
    });
    expect(checkAndRefreshToken).toHaveBeenCalledWith("xai", connection);
    expect(account).toMatchObject({
      authType: "oauth",
      accessToken: "fresh-access",
      refreshToken: "stored-refresh",
      connectionId: "conn-xai",
    });
    expect(account.apiKey).toBeUndefined();
  });

  it("persists refreshed xAI video tokens with a relative expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T00:00:00.000Z"));

    await persistXaiAccount({
      connectionId: "conn-xai",
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: "2026-05-20T00:10:00.000Z",
    });

    expect(updateProviderCredentials).toHaveBeenCalledWith("conn-xai", {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 600,
    });
  });
});
