import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bootstrapLoads: 0,
  initConsoleLogCapture: vi.fn(),
}));

vi.mock("@/lib/consoleLogBuffer", () => ({
  initConsoleLogCapture: state.initConsoleLogCapture,
}));

vi.mock("@/shared/services/bootstrap", () => {
  state.bootstrapLoads += 1;
  return {};
});

vi.mock("open-sse/providers/catalogOverride.js", () => ({
  installCatalogSource: vi.fn(async () => {}),
}));

vi.mock("@/lib/modelCatalog/sync.js", () => ({
  startModelCatalogSync: vi.fn(),
}));

describe("server instrumentation", () => {
  const originalRuntime = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    state.bootstrapLoads = 0;
    state.initConsoleLogCapture.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = originalRuntime;
  });

  it("loads console capture and runtime bootstrap in the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("../../src/instrumentation.js");

    await register();

    expect(state.initConsoleLogCapture).toHaveBeenCalledOnce();
    expect(state.bootstrapLoads).toBe(1);
  });

  it("does not load server services outside the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("../../src/instrumentation.js");

    await register();

    expect(state.initConsoleLogCapture).not.toHaveBeenCalled();
    expect(state.bootstrapLoads).toBe(0);
  });
});
