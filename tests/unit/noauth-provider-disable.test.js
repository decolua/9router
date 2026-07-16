import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
}));

vi.mock("../../src/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { getProviderCredentials } from "../../src/sse/services/auth.js";

describe("no-auth provider disabling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
  });

  it.each(["opencode", "oc", "mimo-free", "mmf"])("enables %s by default", async (provider) => {
    await expect(getProviderCredentials(provider)).resolves.toMatchObject({
      id: "noauth",
      isActive: true,
      accessToken: "public",
    });
  });

  it.each([
    ["opencode", "opencode"],
    ["oc", "opencode"],
    ["mimo-free", "mimo-free"],
    ["mmf", "mimo-free"],
  ])("disables %s using the canonical provider setting", async (provider, providerId) => {
    mocks.getSettings.mockResolvedValue({ disabledProviders: { [providerId]: true } });

    await expect(getProviderCredentials(provider)).resolves.toBeNull();
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
  });
});
