import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCodexUsage: vi.fn() }));

vi.mock("open-sse/services/usage/codex.js", () => ({
  getCodexUsage: mocks.getCodexUsage,
}));

const { checkCodexQuotaBeforeChat, clearCodexQuotaGuardCache } = await import(
  "../../src/sse/services/codexQuotaGuard.js"
);

function credentials(id = "codex-1") {
  return { connectionId: id, accessToken: "secret", providerSpecificData: {} };
}

describe("Codex quota guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCodexQuotaGuardCache();
  });

  it("blocks an account when the Usage API returns 401", async () => {
    mocks.getCodexUsage.mockResolvedValue({
      unavailable: true,
      status: 401,
      message: "Codex connected. Usage API temporarily unavailable (401).",
    });

    await expect(checkCodexQuotaBeforeChat(credentials())).resolves.toEqual({
      available: false,
      status: 401,
      error: "Codex connected. Usage API temporarily unavailable (401).",
      resetsAtMs: null,
    });
  });

  it("blocks exhausted quota until the latest blocking reset", async () => {
    const sessionReset = new Date(Date.now() + 60_000).toISOString();
    const weeklyReset = new Date(Date.now() + 120_000).toISOString();
    mocks.getCodexUsage.mockResolvedValue({
      limitReached: true,
      quotas: {
        session: { remaining: 0, resetAt: sessionReset },
        weekly: { remaining: 0, resetAt: weeklyReset },
      },
    });

    const result = await checkCodexQuotaBeforeChat(credentials());

    expect(result).toMatchObject({ available: false, status: 429 });
    expect(result.error).toContain("session, weekly");
    expect(result.resetsAtMs).toBe(new Date(weeklyReset).getTime());
  });

  it("coalesces concurrent checks and caches healthy results", async () => {
    mocks.getCodexUsage.mockResolvedValue({ limitReached: false, quotas: {} });

    const [first, second] = await Promise.all([
      checkCodexQuotaBeforeChat(credentials()),
      checkCodexQuotaBeforeChat(credentials()),
    ]);
    const third = await checkCodexQuotaBeforeChat(credentials());

    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(third).toEqual({ available: true, cached: true });
    expect(mocks.getCodexUsage).toHaveBeenCalledTimes(1);
  });

  it("force refreshes a cached healthy result after a chat auth/quota error", async () => {
    mocks.getCodexUsage
      .mockResolvedValueOnce({ limitReached: false, quotas: {} })
      .mockResolvedValueOnce({ unavailable: true, status: 401, message: "unauthorized" });

    await checkCodexQuotaBeforeChat(credentials());
    const refreshed = await checkCodexQuotaBeforeChat(credentials(), { force: true });

    expect(refreshed).toMatchObject({ available: false, status: 401 });
    expect(mocks.getCodexUsage).toHaveBeenCalledTimes(2);
  });

  it("fails open when the Usage API cannot be reached", async () => {
    mocks.getCodexUsage.mockRejectedValue(new Error("network down"));

    await expect(checkCodexQuotaBeforeChat(credentials())).resolves.toMatchObject({
      available: true,
      checkFailed: true,
    });
  });
});
