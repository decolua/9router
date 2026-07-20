import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectIdForConnection: vi.fn(),
  refreshProviderCredentials: vi.fn(),
  resolveRefreshProxyOptions: vi.fn(),
  shouldRefreshCredentials: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("../../src/lib/localDb.js", () => ({
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("open-sse/services/projectId.js", () => ({
  getProjectIdForConnection: mocks.getProjectIdForConnection,
  invalidateProjectId: vi.fn(),
  removeConnection: vi.fn(),
}));
vi.mock("open-sse/services/tokenRefresh.js", () => ({
  TOKEN_EXPIRY_BUFFER_MS: 300_000,
  refreshAccessToken: vi.fn(),
  refreshClaudeOAuthToken: vi.fn(),
  refreshGoogleToken: vi.fn(),
  refreshQwenToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  refreshIflowToken: vi.fn(),
  refreshGitHubToken: vi.fn(),
  refreshCopilotToken: vi.fn(),
  getAccessToken: vi.fn(),
  refreshTokenByProvider: vi.fn(),
  formatProviderCredentials: vi.fn(),
  getAllAccessTokens: vi.fn(),
  refreshKiroToken: vi.fn(),
  getRefreshLeadMs: vi.fn(() => 300_000),
}));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: mocks.refreshProviderCredentials,
  resolveRefreshProxyOptions: mocks.resolveRefreshProxyOptions,
  shouldRefreshCredentials: mocks.shouldRefreshCredentials,
}));

const proxyRoute = {
  source: "pool",
  proxyPoolId: "project-refresh-pool",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  strictProxy: true,
  disableEnvProxy: true,
};

describe("background project refresh routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRefreshProxyOptions.mockReturnValue(proxyRoute);
    mocks.shouldRefreshCredentials.mockReturnValue(true);
    mocks.refreshProviderCredentials.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresIn: 3600,
    });
    mocks.updateProviderConnection.mockResolvedValue(true);
    mocks.getProjectIdForConnection.mockResolvedValue("project-id");
  });

  it("passes the normalized route into post-refresh project discovery", async () => {
    const { checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");

    await checkAndRefreshToken("gemini-cli", {
      id: "gemini-connection",
      connectionId: "gemini-connection",
      accessToken: "old-access-token",
      refreshToken: "old-refresh-token",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      providerSpecificData: { proxyPoolId: "project-refresh-pool" },
    }, proxyRoute);
    await vi.waitFor(() => expect(mocks.getProjectIdForConnection).toHaveBeenCalled());

    expect(mocks.getProjectIdForConnection).toHaveBeenCalledWith(
      "gemini-connection",
      "new-access-token",
      proxyRoute,
    );
  });
});
