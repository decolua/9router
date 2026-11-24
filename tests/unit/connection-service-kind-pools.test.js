import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("@/sse/services/auth.js");

const connection = (id, priority, extra = {}) => ({
  id, provider: "codex", priority, isActive: true, accessToken: `${id}-token`, ...extra,
});
const imageOff = { providerSpecificData: { disabledKinds: ["image"] } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({});
});

describe("per-kind connection pools", () => {
  it("skips a connection switched off for the requested kind", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("text-only", 1, imageOff), connection("image", 2)]);
    const credentials = await getProviderCredentials("codex", null, "gpt-image-2", { serviceKind: "image" });
    expect(credentials.connectionId).toBe("image");
  });

  it("keeps that connection for requests without the kind", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("text-only", 1, imageOff), connection("image", 2)]);
    const credentials = await getProviderCredentials("codex", null, "gpt-5.6-terra");
    expect(credentials.connectionId).toBe("text-only");
  });

  it("keeps that connection for a different media kind", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("text-only", 1, imageOff)]);
    const credentials = await getProviderCredentials("codex", null, "transcribe", { serviceKind: "stt" });
    expect(credentials.connectionId).toBe("text-only");
  });

  it("returns no credentials, not a rate limit, when the kind has no connection left", async () => {
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    mocks.getProviderConnections.mockResolvedValue([
      connection("text-only", 1, { ...imageOff, "modelLock_gpt-image-2": lockedUntil }),
    ]);
    await expect(getProviderCredentials("codex", null, "gpt-image-2", { serviceKind: "image" })).resolves.toBeNull();
  });
});
