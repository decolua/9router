import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

/**
 * Regression tests for Kiro API-key auth.
 *
 * KiroService.validateApiKey validates against the Amazon Q model catalog and
 * returns an account-bound credential without inventing a profileArn.
 *
 * Note: OAuth (Builder ID / IDC) profileArn resolution is handled upstream by
 * fetchKiroProfileArn in providers.js and is covered there — not here.
 */
describe("kiro API-key auth (KiroService.validateApiKey)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("validates an API key against Amazon Q without inventing profileArn", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ modelId: "claude-opus-5" }] }),
    });

    const svc = new KiroService();
    const cred = await svc.validateApiKey("  my-secret-key  ");

    expect(cred).toEqual({
      accessToken: "my-secret-key",
      refreshToken: null,
      profileArn: null,
      region: "us-east-1",
      authMethod: "api_key",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR"
    );
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer my-secret-key");
    expect(init.headers.TokenType).toBe("API_KEY");
  });

  it("auto-detects and persists the first supported region for an API key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Forbidden" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ modelId: "claude-opus-5" }] }),
      });

    const cred = await new KiroService().validateApiKey("eu-key", "auto");

    expect(cred.region).toBe("eu-central-1");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://q.us-east-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR",
      "https://q.eu-central-1.amazonaws.com/ListAvailableModels?origin=AI_EDITOR",
    ]);
  });

  it("bounds each official-region API-key validation request", async () => {
    const timeoutSignals = [new AbortController().signal, new AbortController().signal];
    const timeoutMock = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(timeoutSignals[0])
      .mockReturnValueOnce(timeoutSignals[1]);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("first region unavailable"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ modelId: "claude-opus-5" }] }),
      });

    await new KiroService().validateApiKey("eu-key", "auto");

    expect(timeoutMock).toHaveBeenNthCalledWith(1, 10_000);
    expect(timeoutMock).toHaveBeenNthCalledWith(2, 10_000);
    expect(fetchMock.mock.calls[0][1].signal).toBe(timeoutSignals[0]);
    expect(fetchMock.mock.calls[1][1].signal).toBe(timeoutSignals[1]);
  });

  it("rejects unsupported runtime regions before calling AWS", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(new KiroService().validateApiKey("key", "eu-west-1"))
      .rejects.toThrow("Unsupported Kiro runtime region");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an empty API key without a network call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const svc = new KiroService();
    await expect(svc.validateApiKey("   ")).rejects.toThrow("API key is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a validation error when the key is rejected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });
    const svc = new KiroService();
    await expect(svc.validateApiKey("bad-key")).rejects.toThrow(
      /API key validation failed/
    );
  });

  it("rejects a 200 response with an empty model catalog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
    const svc = new KiroService();
    await expect(svc.validateApiKey("empty-key")).rejects.toThrow(
      /returned no available models/
    );
  });
});
