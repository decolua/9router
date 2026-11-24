import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initializeApp } = vi.hoisted(() => ({ initializeApp: vi.fn(async () => {}) }));

vi.mock("@/shared/services/initializeApp.js", () => ({ default: initializeApp }));
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock("open-sse/providers/catalogOverride.js", () => ({ installCatalogSource: vi.fn() }));
vi.mock("@/lib/modelCatalog/sync.js", () => ({ startModelCatalogSync: vi.fn() }));

describe("server startup bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    initializeApp.mockClear();
    vi.stubGlobal("__appBootstrapped", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("initializes once at Node.js server startup without evaluating the root layout", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    const { register } = await import("../../src/instrumentation.js");

    await register();
    expect(initializeApp).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const { register: registerAgain } = await import("../../src/instrumentation.js");
    await registerAgain();
    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["nodejs", "phase-production-build"],
    ["edge", "phase-production-server"],
  ])("skips initialization for %s in %s", async (runtime, phase) => {
    vi.stubEnv("NEXT_RUNTIME", runtime);
    vi.stubEnv("NEXT_PHASE", phase);
    const { register } = await import("../../src/instrumentation.js");

    await register();
    expect(initializeApp).not.toHaveBeenCalled();
  });
});
