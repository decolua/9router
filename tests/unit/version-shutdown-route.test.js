import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  events: [],
  killAppProcesses: vi.fn(async () => { mocks.events.push("kill"); }),
  spawnUpdaterAndExit: vi.fn(() => { mocks.events.push("spawn"); }),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/appUpdater", () => ({
  killAppProcesses: mocks.killAppProcesses,
  spawnUpdaterAndExit: mocks.spawnUpdaterAndExit,
}));

const versionShutdown = await import("../../src/app/api/version/shutdown/route.js");
const versionUpdate = await import("../../src/app/api/version/update/route.js");
const { ShutdownPhase, registerShutdownStep, __test__: coord } = await import(
  "@/lib/runtime/shutdownCoordinator.js"
);

describe("version shutdown routes graceful coordination", () => {
  let exitSpy;
  let originalNodeEnv;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    coord.reset();
    mocks.events.length = 0;
    originalNodeEnv = process.env.NODE_ENV;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
    coord.reset();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("runs coordinator work before killing siblings and exiting", async () => {
    registerShutdownStep("flush-details", async () => { mocks.events.push("coordinator"); }, {
      phase: ShutdownPhase.FLUSH,
    });

    await versionShutdown.POST();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mocks.events).toEqual(["coordinator", "kill"]);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("runs coordinator work before spawning the updater in the update route", async () => {
    process.env.NODE_ENV = "production";
    registerShutdownStep("flush-details", async () => { mocks.events.push("coordinator"); }, {
      phase: ShutdownPhase.FLUSH,
    });

    await versionUpdate.POST();

    expect(mocks.events).toEqual(["coordinator", "kill", "spawn"]);
  });

  it("leaves the update route guarded outside production builds", async () => {
    process.env.NODE_ENV = "test";
    const step = vi.fn(async () => {});
    registerShutdownStep("flush-details", step, { phase: ShutdownPhase.FLUSH });

    const response = await versionUpdate.POST();

    expect(response.status).toBe(403);
    expect(step).not.toHaveBeenCalled();
    expect(mocks.killAppProcesses).not.toHaveBeenCalled();
    expect(mocks.spawnUpdaterAndExit).not.toHaveBeenCalled();
  });
});
