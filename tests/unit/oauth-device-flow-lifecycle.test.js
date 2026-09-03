import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  generateAuthData: vi.fn(),
  getProvider: vi.fn(),
  pollForToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("../../src/lib/oauth/providers.js", () => ({
  exchangeTokens: vi.fn(),
  generateAuthData: mocks.generateAuthData,
  getProvider: mocks.getProvider,
  pollForToken: mocks.pollForToken,
  requestDeviceCode: mocks.requestDeviceCode,
}));
vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

import { GET, POST } from "../../src/app/api/oauth/[provider]/[action]/route.js";

const proxyRoute = {
  source: "pool",
  proxyPoolId: "pool-a",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};
const effectiveProxy = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

async function clearDeviceFlows() {
  const server = await import("../../src/lib/oauth/utils/server.js");
  server.clearDeviceAuthorizationFlows?.();
}

async function startDevice(provider = "qoder", proxyPoolId = "pool-a") {
  const url = new URL(`http://localhost/api/oauth/${provider}/device-code`);
  if (proxyPoolId) url.searchParams.set("proxyPoolId", proxyPoolId);
  return GET(new Request(url), {
    params: Promise.resolve({ provider, action: "device-code" }),
  });
}

function postDevice(provider, action, body) {
  return POST(new Request(`http://localhost/api/oauth/${provider}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), {
    params: Promise.resolve({ provider, action }),
  });
}

describe("server-owned device OAuth lifecycle", () => {
  beforeEach(async () => {
    await clearDeviceFlows();
    vi.clearAllMocks();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue(true);
    mocks.getProvider.mockReturnValue({ flowType: "device_code" });
    mocks.generateAuthData.mockResolvedValue({
      codeVerifier: "generic-verifier",
      codeChallenge: "generic-challenge",
    });
    mocks.requestDeviceCode.mockResolvedValue({
      device_code: "server-device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://provider.test/device",
      interval: 1,
      expires_in: 300,
      codeVerifier: "server-verifier",
      _qoderMachineId: "server-machine",
      _qoderNonce: "server-device-code",
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxyRoute);
    mocks.pollForToken.mockResolvedValue({
      success: false,
      error: "authorization_pending",
      pending: true,
    });
    mocks.createProviderConnection.mockImplementation(async (data) => ({ id: "connection-1", ...data }));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("server-flow-id");
  });

  afterEach(async () => {
    await clearDeviceFlows();
    vi.restoreAllMocks();
  });

  it("keeps device code, PKCE, provider context, and proxy routing server-owned", async () => {
    const response = await startDevice();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      flowId: "server-flow-id",
      user_code: "ABCD-EFGH",
      verification_uri: "https://provider.test/device",
    });
    for (const field of ["device_code", "codeVerifier", "_qoderMachineId", "_qoderNonce"]) {
      expect(body).not.toHaveProperty(field);
    }

    const poll = await postDevice("qoder", "poll", {
      flowId: body.flowId,
      deviceCode: "attacker-device",
      codeVerifier: "attacker-verifier",
      extraData: { _qoderMachineId: "attacker-machine" },
      proxyPoolId: "attacker-pool",
    });

    expect(poll.status).toBe(200);
    expect(mocks.resolveConnectionProxyConfig).toHaveBeenCalledTimes(1);
    expect(mocks.pollForToken).toHaveBeenCalledWith(
      "qoder",
      "server-device-code",
      "server-verifier",
      expect.objectContaining({ _qoderMachineId: "server-machine" }),
      effectiveProxy,
    );
  });

  it("reserves bounded capacity before provider device-code I/O", async () => {
    vi.mocked(globalThis.crypto.randomUUID).mockImplementation(() => (
      `capacity-flow-${mocks.requestDeviceCode.mock.calls.length}`
    ));
    mocks.requestDeviceCode.mockImplementation(async () => ({
      device_code: `device-${mocks.requestDeviceCode.mock.calls.length}`,
      user_code: "CODE",
      verification_uri: "https://provider.test/device",
    }));

    for (let index = 0; index < 128; index += 1) {
      expect((await startDevice("github")).status).toBe(200);
    }
    const rejected = await startDevice("github");

    expect(rejected.status).toBe(503);
    expect(mocks.requestDeviceCode).toHaveBeenCalledTimes(128);
  });

  it("consumes a successful device flow once and rejects replay", async () => {
    const started = await startDevice("github");
    const { flowId } = await started.json();
    mocks.pollForToken.mockResolvedValue({
      success: true,
      tokens: { accessToken: "access-token", refreshToken: "refresh-token" },
    });

    expect((await postDevice("github", "poll", { flowId })).status).toBe(200);
    expect((await postDevice("github", "poll", { flowId })).status).toBe(409);
    expect(mocks.pollForToken).toHaveBeenCalledTimes(1);
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("binds cancellation to the admitted flow and blocks later polling", async () => {
    const started = await startDevice("github");
    const { flowId } = await started.json();

    expect((await postDevice("github", "cancel-poll", { flowId })).status).toBe(200);
    expect((await postDevice("github", "poll", { flowId })).status).toBe(409);
    expect(mocks.pollForToken).not.toHaveBeenCalled();
  });

  it("rechecks device identity inside delayed persistence admission", async () => {
    const started = await startDevice("github");
    const { flowId } = await started.json();
    mocks.pollForToken.mockResolvedValue({
      success: true,
      tokens: { accessToken: "late-access-token", refreshToken: "late-refresh-token" },
    });
    let releaseAdmission;
    let persisted = false;
    mocks.createProviderConnection.mockImplementation(async (_data, options) => {
      await new Promise((resolve) => { releaseAdmission = resolve; });
      if (options?.beforePersist?.() === false) throw new Error("OAuth flow was cancelled");
      persisted = true;
      return { id: "late-connection", provider: "github" };
    });

    const polling = postDevice("github", "poll", { flowId });
    await vi.waitFor(() => expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1));
    expect((await postDevice("github", "cancel-poll", { flowId })).status).toBe(200);
    releaseAdmission();
    const response = await polling;

    expect(response.status).toBe(409);
    expect(persisted).toBe(false);
  });
});
