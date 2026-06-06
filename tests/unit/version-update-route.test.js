import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  killAppProcesses: vi.fn(),
  spawnUpdaterAndExit: vi.fn(),
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/appUpdater", () => ({
  killAppProcesses: mocks.killAppProcesses,
  spawnUpdaterAndExit: mocks.spawnUpdaterAndExit,
}));

function request(body) {
  return { json: vi.fn(async () => body) };
}

describe("version update API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
  });

  it("starts the updater for a selected historical version", async () => {
    const { POST } = await import("../../src/app/api/version/update/route.js");

    const response = await POST(request({ version: "v0.4.65" }));

    expect(response.status).toBe(200);
    expect(mocks.killAppProcesses).toHaveBeenCalledOnce();
    expect(mocks.spawnUpdaterAndExit).toHaveBeenCalledWith("9router@0.4.65");
  });

  it("rejects malformed target versions", async () => {
    const { POST } = await import("../../src/app/api/version/update/route.js");

    const response = await POST(request({ version: "latest; rm -rf /" }));

    expect(response.status).toBe(400);
    expect(mocks.spawnUpdaterAndExit).not.toHaveBeenCalled();
  });
});
