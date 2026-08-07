import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/services/oauthCredentialManager.js", () => ({
  refreshProviderCredentials: vi.fn(),
}));

import { refreshProviderCredentials } from "../../open-sse/services/oauthCredentialManager.js";
import {
  parseGrokCliModels,
  resolveGrokCliModels,
} from "../../open-sse/services/grokCliModels.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Grok CLI live models", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes official model metadata", () => {
    expect(parseGrokCliModels({
      models: [{
        model_id: "grok-build",
        display_name: "Grok Build",
        context_window: 500000,
        max_output_tokens: 64000,
        supported_in_api: false,
      }],
    })).toEqual([
      expect.objectContaining({
        id: "grok-build",
        name: "Grok Build",
        contextLength: 500000,
        maxOutputTokens: 64000,
        supported_in_api: false,
      }),
    ]);
  });

  it("refreshes and retries through selected proxy", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "grok-build" }] }));
    const onCredentialsRefreshed = vi.fn();
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    };
    refreshProviderCredentials.mockResolvedValue({ accessToken: "new-token" });

    const result = await resolveGrokCliModels({
      accessToken: "old-token",
      refreshToken: "refresh-token",
      providerSpecificData: { email: "user@example.com" },
    }, { fetchFn, proxyOptions, onCredentialsRefreshed });

    expect(result.models).toEqual([
      expect.objectContaining({
        id: "grok-build",
        contextLength: 500000,
        maxOutputTokens: 64000,
      }),
    ]);
    expect(refreshProviderCredentials).toHaveBeenCalledWith(
      "grok-cli",
      expect.any(Object),
      expect.anything(),
      proxyOptions,
    );
    expect(onCredentialsRefreshed).toHaveBeenCalledWith({ accessToken: "new-token" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][2]).toBe(proxyOptions);
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe("Bearer new-token");
    expect(fetchFn.mock.calls[1][1].headers["x-grok-client-version"]).toBe("0.2.99");
  });
});
