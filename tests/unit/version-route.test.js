import { beforeEach, describe, expect, it, vi } from "vitest";

const getVersionStatus = vi.fn();
vi.mock("@/lib/update/versionPolicy.js", () => ({ getVersionStatus }));

describe("GET /api/version", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns fork-ready state with only the scoped install command", async () => {
    getVersionStatus.mockResolvedValue({
      currentVersion: "0.5.40-fork.1",
      forkLatestVersion: "0.5.40-fork.2",
      upstreamLatestVersion: "0.5.40",
      forkUpdateAvailable: true,
      upstreamUpdatePending: false,
      updatePackageName: "@loldlm1/9router",
      installCommand: "npm i -g @loldlm1/9router@latest --prefer-online",
    });
    const { GET } = await import("../../src/app/api/version/route.js");

    const response = await GET();
    const body = await response.json();

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.forkUpdateAvailable).toBe(true);
    expect(body.installCommand).toBe("npm i -g @loldlm1/9router@latest --prefer-online");
    expect(body.installCommand).not.toBe("npm i -g 9router@latest --prefer-online");
  });

  it("returns upstream-pending state without fabricating a fork update", async () => {
    getVersionStatus.mockResolvedValue({
      currentVersion: "0.5.40-fork.1",
      forkLatestVersion: null,
      upstreamLatestVersion: "0.5.41",
      forkUpdateAvailable: false,
      upstreamUpdatePending: true,
      updatePackageName: "@loldlm1/9router",
      installCommand: "npm i -g @loldlm1/9router@latest --prefer-online",
    });
    const { GET } = await import("../../src/app/api/version/route.js");

    const body = await (await GET()).json();

    expect(body).toMatchObject({
      forkUpdateAvailable: false,
      upstreamUpdatePending: true,
      forkLatestVersion: null,
    });
  });
});
