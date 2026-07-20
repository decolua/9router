import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  refreshCopilotToken: vi.fn(),
  refreshKiroToken: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshCopilotToken: mocks.refreshCopilotToken,
  refreshKiroToken: mocks.refreshKiroToken,
}));

import { clearKiroModelCache, resolveKiroModels } from "../../open-sse/services/kiroModels.js";
import { resolveCopilotModels } from "../../open-sse/services/copilotModels.js";
import { resolveClinepassModels } from "../../open-sse/services/clinepassModels.js";
import { clearQoderCatalog, resolveQoderModels } from "../../open-sse/services/qoderModels.js";
import { clearKimchiCatalog, resolveKimchiModels } from "../../open-sse/services/kimchiModels.js";

const originalFetch = globalThis.fetch;
const proxyRoute = {
  source: "pool",
  proxyPoolId: "pool-models",
  proxyPool: { id: "pool-models" },
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("live model service proxy routing", () => {
  beforeEach(() => {
    mocks.proxyAwareFetch.mockReset();
    mocks.refreshCopilotToken.mockReset();
    mocks.refreshKiroToken.mockReset();
    clearKiroModelCache();
    clearQoderCatalog();
    clearKimchiCatalog();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes Kiro catalog fetch and refresh retry through one proxy context", async () => {
    const responses = [
      jsonResponse({ error: "expired" }, 401),
      jsonResponse({ models: [{ modelId: "kiro-model", modelName: "Kiro Model" }] }),
    ];
    mocks.proxyAwareFetch.mockImplementation(async () => responses.shift());
    globalThis.fetch.mockImplementation(async () => responses.shift());
    mocks.refreshKiroToken.mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh" });

    const result = await resolveKiroModels({
      accessToken: "old-access",
      refreshToken: "refresh-token-kiro",
      providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test" },
    }, { forceRefresh: true, proxyOptions: proxyRoute, log: console });

    expect(result.models).toHaveLength(4);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(mocks.proxyAwareFetch.mock.calls.every((call) => call.at(-1) === proxyRoute)).toBe(true);
    expect(mocks.refreshKiroToken).toHaveBeenCalledWith(
      "refresh-token-kiro",
      expect.any(Object),
      console,
      proxyRoute,
    );
  });

  it("routes Copilot catalog fetch and token refresh through one proxy context", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: "copilot-model", capabilities: { type: "chat" }, policy: { state: "enabled" } }],
      }));
    mocks.refreshCopilotToken.mockResolvedValue({ token: "new-copilot-token", expiresAt: 12345 });

    const result = await resolveCopilotModels({
      accessToken: "github-access-unique",
      providerSpecificData: { copilotToken: "old-copilot-unique" },
    }, { forceRefresh: true, proxyOptions: proxyRoute, log: console });

    expect(result.models).toEqual([{ id: "copilot-model", name: "copilot-model" }]);
    expect(mocks.proxyAwareFetch.mock.calls.every((call) => call.at(-1) === proxyRoute)).toBe(true);
    expect(mocks.refreshCopilotToken).toHaveBeenCalledWith("github-access-unique", console, proxyRoute);
  });

  it("keeps Qoder and Kimchi catalog fetches on the selected route", async () => {
    mocks.proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({
        chat: [{ key: "qoder-model", display_name: "Qoder Model", enable: true }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        models: [{ slug: "kimchi-model", display_name: "Kimchi Model" }],
      }));

    await expect(resolveQoderModels({
      accessToken: "qoder-access",
      refreshToken: "qoder-refresh",
      providerSpecificData: { userId: "qoder-user" },
    }, { forceRefresh: true, proxyOptions: proxyRoute })).resolves.toMatchObject({
      models: [expect.objectContaining({ id: "qoder-model" })],
    });
    await expect(resolveKimchiModels({
      accessToken: "kimchi-access",
      providerSpecificData: { userId: "kimchi-user" },
    }, { forceRefresh: true, proxyOptions: proxyRoute })).resolves.toMatchObject({
      models: [expect.objectContaining({ id: "kimchi-model" })],
    });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(mocks.proxyAwareFetch.mock.calls.every((call) => call.at(-1) === proxyRoute)).toBe(true);
  });

  it("keeps ClinePass catalog fetch on the selected route", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse({
      data: [{ id: "cline-pass/model-1", name: "Model 1" }],
    }));

    await expect(resolveClinepassModels({ accessToken: "clinepass-access" }, { proxyOptions: proxyRoute }))
      .resolves.toEqual({ models: [{ id: "cline-pass/model-1", name: "Model 1" }] });

    expect(globalThis.fetch.mock.calls[0][1].proxyOptions).toBe(proxyRoute);
  });

  it.each([
    ["Kiro", async (log, persist) => {
      mocks.proxyAwareFetch
        .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
        .mockResolvedValueOnce(jsonResponse({ models: [{ modelId: "kiro-model" }] }));
      mocks.refreshKiroToken.mockResolvedValue({ accessToken: "new-kiro-token" });
      return resolveKiroModels({
        accessToken: "old-kiro-token",
        refreshToken: "kiro-refresh",
        providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test" },
      }, { forceRefresh: true, log, onCredentialsRefreshed: persist, proxyOptions: proxyRoute });
    }],
    ["Copilot", async (log, persist) => {
      mocks.proxyAwareFetch
        .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: "copilot-model", capabilities: { type: "chat" } }] }));
      mocks.refreshCopilotToken.mockResolvedValue({ token: "new-copilot-token", expiresAt: 123 });
      return resolveCopilotModels({
        accessToken: "github-token",
        providerSpecificData: { copilotToken: "old-copilot-token" },
      }, { forceRefresh: true, log, onCredentialsRefreshed: persist, proxyOptions: proxyRoute });
    }],
  ])("sanitizes %s credential persistence failures", async (_provider, run) => {
    const secret = "https://user:password@provider.test/token?refresh_token=SECRET-REFRESH";
    const log = { info: vi.fn(), warn: vi.fn() };

    await run(log, vi.fn(async () => { throw new Error(secret); }));
    const output = log.warn.mock.calls.flat().map(String).join(" ");

    for (const value of ["user", "password", "SECRET-REFRESH"]) expect(output).not.toContain(value);
  });
});
