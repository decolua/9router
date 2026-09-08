import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshXaiToken } = vi.hoisted(() => ({ refreshXaiToken: vi.fn() }));

vi.mock("../../open-sse/services/tokenRefresh/providers.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, refreshXaiToken };
});

describe("xAI default executor reactive refresh", () => {
  beforeEach(() => refreshXaiToken.mockReset());

  it("refreshes an OAuth credential after an upstream 401/403", async () => {
    refreshXaiToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
    });

    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const executor = new DefaultExecutor("xai");
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const credentials = { accessToken: "expired", refreshToken: "refresh-token" };

    const result = await executor.refreshCredentials(credentials, log);

    expect(refreshXaiToken).toHaveBeenCalledWith("refresh-token", log);
    expect(result).toEqual({
      accessToken: "new-access-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
    });
  });
});
