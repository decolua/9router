import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  xaiRefresh: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  normalizeExplicitProxyOptions(proxyOptions) {
    const hasProxy = proxyOptions?.connectionProxyEnabled === true && proxyOptions?.connectionProxyUrl;
    return hasProxy || proxyOptions?.vercelRelayUrl || proxyOptions?.proxyUnavailable
      ? proxyOptions
      : { disableEnvProxy: true };
  },
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

vi.mock("../../src/lib/oauth/services/xai.js", () => ({
  XaiService: class {
    refreshAccessToken(...args) {
      return mocks.xaiRefresh(...args);
    }
  },
}));

import { refreshProviderCredentials } from "../../open-sse/services/oauthCredentialManager.js";

const originalFetch = globalThis.fetch;
const selectedProxyOptions = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

const providers = [
  "gemini",
  "gemini-cli",
  "antigravity",
  "claude",
  "qwen",
  "iflow",
  "github",
  "codebuddy-cn",
  "codex",
  "kiro",
  "xai",
  "grok-cli",
];

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

function credentialsFor(provider, suffix, withProxy) {
  return {
    connectionId: `${provider}-${suffix}`,
    refreshToken: `${provider}-${suffix}-refresh`,
    providerSpecificData: {
      ...(provider === "kiro"
        ? { authMethod: "google", profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/test" }
        : {}),
      ...(withProxy ? selectedProxyOptions : {}),
    },
  };
}

function lastProxyOptions(provider) {
  if (provider === "xai" || provider === "grok-cli") {
    return mocks.xaiRefresh.mock.calls.at(-1)?.[1];
  }
  return globalThis.fetch.mock.calls.at(-1)?.[1]?.proxyOptions;
}

describe("proactive OAuth refresh routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(async (url) => {
      const target = String(url);
      if (target.includes("copilot.tencent.com")) {
        return jsonResponse({
          code: 0,
          data: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 },
        });
      }
      if (target.includes("auth.desktop.kiro.dev")) {
        return jsonResponse({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 });
      }
      return jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
    });
    mocks.proxyAwareFetch.mockImplementation((url, options, proxyOptions) => (
      globalThis.fetch(url, { ...options, proxyOptions })
    ));
    mocks.xaiRefresh.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(providers)("routes %s refresh through selected proxy", async (provider) => {
    const result = await refreshProviderCredentials(
      provider,
      credentialsFor(provider, "proxied", true),
      null,
    );

    expect(result?.accessToken).toBe("new-access");
    expect(lastProxyOptions(provider)).toEqual(selectedProxyOptions);
  });

  it.each(providers)("disables ambient env proxy for Direct %s refresh", async (provider) => {
    const result = await refreshProviderCredentials(
      provider,
      credentialsFor(provider, "direct", false),
      null,
    );

    expect(result?.accessToken).toBe("new-access");
    expect(lastProxyOptions(provider)).toEqual({ disableEnvProxy: true });
  });

  it("passes resolved pool context through manual provider tests", () => {
    const source = readFileSync(fileURLToPath(new URL(
      "../../src/app/api/providers/[id]/test/testUtils.js",
      import.meta.url,
    )), "utf8");

    expect(source).toContain("refreshProviderCredentials(provider, connection, console, effectiveProxy)");
  });

  it("sanitizes credential-bearing provider bodies in refresh logs", async () => {
    const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const raw = "https://user:password@provider.test/token?code=LOG-CODE&access_token=LOG-ACCESS&refresh_token=LOG-REFRESH body=LOG-BODY";
    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => raw,
    });

    await refreshProviderCredentials(
      "codex",
      credentialsFor("codex", "sanitized-log", false),
      log,
      { disableEnvProxy: true },
    );

    const output = log.error.mock.calls.flat().map((value) => (
      typeof value === "string" ? value : JSON.stringify(value)
    )).join(" ");
    for (const secret of ["user", "password", "LOG-CODE", "LOG-ACCESS", "LOG-REFRESH", "LOG-BODY"]) {
      expect(output).not.toContain(secret);
    }
  });
});
