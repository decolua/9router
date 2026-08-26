import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
    headers: init?.headers,
  })),
  getGitUpdateStatus: vi.fn(),
  startGitUpdate: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/gitUpdate", () => ({
  getGitUpdateStatus: mocks.getGitUpdateStatus,
  startGitUpdate: mocks.startGitUpdate,
}));

const { GET, POST } = await import("../../src/app/api/version/git-update/route.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
});

describe("GET /api/version/git-update", () => {
  it("refreshes Git status by default", async () => {
    mocks.getGitUpdateStatus.mockResolvedValue({ updateAvailable: false });

    const response = await GET(new Request("http://localhost/api/version/git-update"));

    expect(response.status).toBe(200);
    expect(mocks.getGitUpdateStatus).toHaveBeenCalledWith({ refresh: true });
    expect(response.headers).toEqual({ "Cache-Control": "no-store" });
  });

  it("supports polling without fetching the remote", async () => {
    mocks.getGitUpdateStatus.mockResolvedValue({ updateInProgress: true });

    await GET(new Request("http://localhost/api/version/git-update?refresh=0"));

    expect(mocks.getGitUpdateStatus).toHaveBeenCalledWith({ refresh: false });
  });
});

describe("POST /api/version/git-update", () => {
  it("rejects update execution outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await POST();

    expect(response.status).toBe(403);
    expect(mocks.getGitUpdateStatus).not.toHaveBeenCalled();
  });

  it("rejects when no update is available", async () => {
    mocks.getGitUpdateStatus.mockResolvedValue({ updateAvailable: false });

    const response = await POST();

    expect(response.status).toBe(409);
    expect(mocks.startGitUpdate).not.toHaveBeenCalled();
  });

  it("returns the repository block reason", async () => {
    mocks.getGitUpdateStatus.mockResolvedValue({
      updateAvailable: true,
      canUpdate: false,
      blockedReason: "Working tree has local changes.",
    });

    const response = await POST();

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Working tree has local changes.");
  });

  it("starts the detached update worker", async () => {
    const operation = { operationId: "operation-1", status: "running" };
    mocks.getGitUpdateStatus.mockResolvedValue({
      updateAvailable: true,
      canUpdate: true,
      repoRoot: "/srv/9router",
    });
    mocks.startGitUpdate.mockReturnValue(operation);

    const response = await POST();

    expect(response.status).toBe(202);
    expect(mocks.startGitUpdate).toHaveBeenCalledWith({ repoRoot: "/srv/9router" });
    expect(response.body).toMatchObject({ success: true, operation });
  });
});
