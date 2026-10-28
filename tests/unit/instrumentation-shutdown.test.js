import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock("open-sse/providers/catalogOverride.js", () => ({
  installCatalogSource: vi.fn(async () => {}),
}));
vi.mock("@/lib/modelCatalog/sync.js", () => ({ startModelCatalogSync: vi.fn() }));

const { register } = await import("@/instrumentation.js");
const { __test__: coord } = await import("@/lib/runtime/shutdownCoordinator.js");

function signalSnapshot() {
  return {
    SIGINT: process.listeners("SIGINT").length,
    SIGTERM: process.listeners("SIGTERM").length,
    beforeExit: process.listeners("beforeExit").length,
  };
}

describe("instrumentation shutdown install", () => {
  let originalRuntime;

  beforeEach(() => {
    originalRuntime = process.env.NEXT_RUNTIME;
    coord.reset();
  });

  afterEach(() => {
    coord.reset();
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
  });

  it("installs process signal handlers at the Node server boot boundary (API-only workloads)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const before = signalSnapshot();

    await register();

    const after = signalSnapshot();
    expect(after.SIGINT - before.SIGINT).toBe(1);
    expect(after.SIGTERM - before.SIGTERM).toBe(1);
    expect(after.beforeExit - before.beforeExit).toBe(1);
  });

  it("stays harmless when the dashboard bootstrap installs handlers too", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    const installed = signalSnapshot();

    const { installProcessSignalHandlers } = await import("@/lib/runtime/shutdownCoordinator.js");
    installProcessSignalHandlers();

    expect(signalSnapshot()).toEqual(installed);
  });

  it("is idempotent across repeated register() calls", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    const installed = signalSnapshot();

    await register();

    expect(signalSnapshot()).toEqual(installed);
  });

  it("does not install signal handlers outside the Node server runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const before = signalSnapshot();

    await register();

    expect(signalSnapshot()).toEqual(before);
  });
});
