import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  authorization: "Bearer test-secret",
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("next/headers", () => ({
  headers: () => ({ get: (name) => (name === "authorization" ? mocks.authorization : null) }),
}));

const { POST } = await import("../../src/app/api/shutdown/route.js");
const { ShutdownPhase, registerShutdownStep, __test__: coord } = await import(
  "@/lib/runtime/shutdownCoordinator.js"
);

describe("POST /api/shutdown graceful coordination", () => {
  let exitSpy;
  const originalSecret = process.env.SHUTDOWN_SECRET;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    coord.reset();
    mocks.authorization = "Bearer test-secret";
    process.env.SHUTDOWN_SECRET = "test-secret";
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.clearAllTimers();
    vi.useRealTimers();
    coord.reset();
    if (originalSecret === undefined) delete process.env.SHUTDOWN_SECRET;
    else process.env.SHUTDOWN_SECRET = originalSecret;
  });

  it("awaits coordinator cleanup before scheduling the process exit", async () => {
    const events = [];
    registerShutdownStep("flush-details", async () => { events.push("flush"); }, { phase: ShutdownPhase.FLUSH });

    await POST();

    expect(events).toEqual(["flush"]);
    expect(exitSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("runs cleanup exactly once even when shutdown is requested twice", async () => {
    const step = vi.fn(async () => {});
    registerShutdownStep("flush-details", step, { phase: ShutdownPhase.FLUSH });

    await POST();
    await POST();
    await vi.advanceTimersByTimeAsync(2000);

    expect(step).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalled();
  });

  it("does not run cleanup or exit for an unauthorized request", async () => {
    mocks.authorization = "Bearer wrong";
    const step = vi.fn(async () => {});
    registerShutdownStep("flush-details", step, { phase: ShutdownPhase.FLUSH });

    const response = await POST();
    await vi.advanceTimersByTimeAsync(2000);

    expect(response.status).toBe(401);
    expect(step).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
