import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consoleLogMocks = vi.hoisted(() => ({
  initConsoleLogCapture: vi.fn(),
}));

const catalogMocks = vi.hoisted(() => ({
  installCatalogSource: vi.fn().mockResolvedValue(undefined),
  startModelCatalogSync: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

const staggerMocks = vi.hoisted(() => ({
  hasQuotaAutoPingEnabled: vi.fn(),
}));

const autoPingMocks = vi.hoisted(() => ({
  configureQuotaAutoPing: vi.fn(),
  quotaAutoPingModuleEvaluated: vi.fn(),
}));

vi.mock("@/lib/consoleLogBuffer", () => ({
  initConsoleLogCapture: consoleLogMocks.initConsoleLogCapture,
}));

vi.mock("open-sse/providers/catalogOverride.js", () => ({
  installCatalogSource: catalogMocks.installCatalogSource,
}));

vi.mock("@/lib/modelCatalog/sync.js", () => ({
  startModelCatalogSync: catalogMocks.startModelCatalogSync,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: dbMocks.getSettings,
}));

vi.mock("@/shared/services/quotaStagger.js", () => ({
  hasQuotaAutoPingEnabled: staggerMocks.hasQuotaAutoPingEnabled,
}));

describe("instrumentation register auto-ping bootstrap", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.doMock("@/shared/services/quotaAutoPing.js", () => {
      autoPingMocks.quotaAutoPingModuleEvaluated();
      return {
        configureQuotaAutoPing: autoPingMocks.configureQuotaAutoPing,
      };
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is a complete no-op when runtime is edge or non-nodejs", async () => {
    process.env.NEXT_RUNTIME = "edge";

    const { register } = await import("@/instrumentation.js");
    await register();

    expect(consoleLogMocks.initConsoleLogCapture).not.toHaveBeenCalled();
    expect(catalogMocks.installCatalogSource).not.toHaveBeenCalled();
    expect(catalogMocks.startModelCatalogSync).not.toHaveBeenCalled();
    expect(dbMocks.getSettings).not.toHaveBeenCalled();
    expect(autoPingMocks.quotaAutoPingModuleEvaluated).not.toHaveBeenCalled();
  });

  it.each([
    "phase-production-build",
    "phase-export",
    "phase-static",
  ])("runs catalog sync but skips auto-ping during Next build phase %s", async (phase) => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = phase;

    const { register } = await import("@/instrumentation.js");
    await register();

    expect(consoleLogMocks.initConsoleLogCapture).toHaveBeenCalledTimes(1);
    expect(catalogMocks.installCatalogSource).toHaveBeenCalledTimes(1);
    expect(catalogMocks.startModelCatalogSync).toHaveBeenCalledTimes(1);
    expect(dbMocks.getSettings).not.toHaveBeenCalled();
    expect(autoPingMocks.quotaAutoPingModuleEvaluated).not.toHaveBeenCalled();
    expect(autoPingMocks.configureQuotaAutoPing).not.toHaveBeenCalled();
  });

  it("never imports quotaAutoPing module when auto-ping is disabled", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;

    dbMocks.getSettings.mockResolvedValue({});
    staggerMocks.hasQuotaAutoPingEnabled.mockReturnValue(false);

    const { register } = await import("@/instrumentation.js");
    await register();

    expect(consoleLogMocks.initConsoleLogCapture).toHaveBeenCalledTimes(1);
    expect(catalogMocks.installCatalogSource).toHaveBeenCalledTimes(1);
    expect(catalogMocks.startModelCatalogSync).toHaveBeenCalledTimes(1);
    expect(dbMocks.getSettings).toHaveBeenCalledTimes(1);
    expect(staggerMocks.hasQuotaAutoPingEnabled).toHaveBeenCalledWith({});
    expect(autoPingMocks.quotaAutoPingModuleEvaluated).not.toHaveBeenCalled();
    expect(autoPingMocks.configureQuotaAutoPing).not.toHaveBeenCalled();
  });

  it("dynamically imports quotaAutoPing and configures scheduler on nodejs opt-in", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;

    const optInSettings = { codexAutoPing: { connections: { "cx-1": true } } };
    dbMocks.getSettings.mockResolvedValue(optInSettings);
    staggerMocks.hasQuotaAutoPingEnabled.mockReturnValue(true);

    const { register } = await import("@/instrumentation.js");
    await register();

    expect(consoleLogMocks.initConsoleLogCapture).toHaveBeenCalledTimes(1);
    expect(catalogMocks.installCatalogSource).toHaveBeenCalledTimes(1);
    expect(catalogMocks.startModelCatalogSync).toHaveBeenCalledTimes(1);
    expect(dbMocks.getSettings).toHaveBeenCalledTimes(1);
    expect(autoPingMocks.quotaAutoPingModuleEvaluated).toHaveBeenCalledTimes(1);
    expect(autoPingMocks.configureQuotaAutoPing).toHaveBeenCalledWith(optInSettings);
  });

  it("catches errors gracefully and does not throw if database or settings are unavailable", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    dbMocks.getSettings.mockRejectedValue(new Error("DB cold / locked"));

    const { register } = await import("@/instrumentation.js");
    await expect(register()).resolves.toBeUndefined();

    expect(consoleLogMocks.initConsoleLogCapture).toHaveBeenCalledTimes(1);
    expect(catalogMocks.installCatalogSource).toHaveBeenCalledTimes(1);
    expect(catalogMocks.startModelCatalogSync).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("[AutoPing] instrumentation start failed:", "DB cold / locked");
    expect(autoPingMocks.quotaAutoPingModuleEvaluated).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
