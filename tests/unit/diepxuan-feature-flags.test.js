import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDiepXuanEnabled = process.env.DIEPXUAN_ENABLED;
const originalDiepXuanSafeMode = process.env.DIEPXUAN_SAFE_MODE;

function restoreEnv() {
  if (originalDiepXuanEnabled === undefined) delete process.env.DIEPXUAN_ENABLED;
  else process.env.DIEPXUAN_ENABLED = originalDiepXuanEnabled;

  if (originalDiepXuanSafeMode === undefined) delete process.env.DIEPXUAN_SAFE_MODE;
  else process.env.DIEPXUAN_SAFE_MODE = originalDiepXuanSafeMode;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.DIEPXUAN_ENABLED;
  delete process.env.DIEPXUAN_SAFE_MODE;
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  restoreEnv();
});

describe("DiepXuan feature flags", () => {
  it("enables DiepXuan hooks by default when DIEPXUAN_ENABLED is unset", async () => {
    const { isDiepXuanEnabled } = await import("@/diepxuan/shared/config/flags.js");
    expect(isDiepXuanEnabled()).toBe(true);
  });

  it("disables DiepXuan hooks when DIEPXUAN_ENABLED=0", async () => {
    process.env.DIEPXUAN_ENABLED = "0";

    const { isDiepXuanEnabled } = await import("@/diepxuan/shared/config/flags.js");
    expect(isDiepXuanEnabled()).toBe(false);
  });

  it("enables safe mode only when DIEPXUAN_SAFE_MODE is truthy", async () => {
    const { isDiepXuanSafeMode } = await import("@/diepxuan/shared/config/flags.js");
    expect(isDiepXuanSafeMode()).toBe(false);

    process.env.DIEPXUAN_SAFE_MODE = "1";
    expect(isDiepXuanSafeMode()).toBe(true);
  });
});

describe("DiepXuan usage override", () => {
  it("handleUsageOverrideResponse returns a JSON response for manual quota providers", async () => {
    const quota = { provider: "alicode", plan: "lite", quotas: [] };
    const getManualQuota = vi.fn(async () => quota);

    vi.doMock("@/diepxuan/lib/db/repos/manualQuotaRepo.js", () => ({
      hasManualQuota: vi.fn((provider) => provider === "alicode"),
      getManualQuota,
    }));

    const { handleUsageOverrideResponse } = await import("@/diepxuan/usage/index.js");
    const response = await handleUsageOverrideResponse(
      { provider: "alicode", id: "conn-1" },
      "conn-1",
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(quota);
  });

  it("handleUsageOverrideResponse returns null when DiepXuan is disabled", async () => {
    process.env.DIEPXUAN_ENABLED = "0";
    const getManualQuota = vi.fn(async () => ({ provider: "alicode" }));

    vi.doMock("@/diepxuan/lib/db/repos/manualQuotaRepo.js", () => ({
      hasManualQuota: vi.fn(() => true),
      getManualQuota,
    }));

    const { handleUsageOverrideResponse } = await import("@/diepxuan/usage/index.js");
    const response = await handleUsageOverrideResponse(
      { provider: "alicode", id: "conn-1" },
      "conn-1",
    );

    expect(response).toBeNull();
    expect(getManualQuota).not.toHaveBeenCalled();
  });

  it("returns manual quota for providers handled by DiepXuan", async () => {
    const quota = { provider: "alicode", plan: "lite", quotas: [] };
    const getManualQuota = vi.fn(async () => quota);

    vi.doMock("@/diepxuan/lib/db/repos/manualQuotaRepo.js", () => ({
      hasManualQuota: vi.fn((provider) => provider === "alicode"),
      getManualQuota,
    }));

    const { getUsageOverride } = await import("@/diepxuan/usage/index.js");
    const result = await getUsageOverride(
      { provider: "alicode", id: "conn-1" },
      "conn-1",
    );

    expect(result).toBe(quota);
    expect(getManualQuota).toHaveBeenCalledWith(
      "alicode",
      "conn-1",
      expect.objectContaining({ provider: "alicode" }),
    );
  });

  it("falls back to upstream behavior when DiepXuan is disabled", async () => {
    process.env.DIEPXUAN_ENABLED = "0";

    const getManualQuota = vi.fn(async () => ({ provider: "alicode" }));

    vi.doMock("@/diepxuan/lib/db/repos/manualQuotaRepo.js", () => ({
      hasManualQuota: vi.fn(() => true),
      getManualQuota,
    }));

    const { getUsageOverride } = await import("@/diepxuan/usage/index.js");
    const result = await getUsageOverride(
      { provider: "alicode", id: "conn-1" },
      "conn-1",
    );

    expect(result).toBeNull();
    expect(getManualQuota).not.toHaveBeenCalled();
  });
});

describe("DiepXuan combo fail tracker hook", () => {
  it("beforeComboModelAttempt skips and logs a model after repeated failures", async () => {
    const {
      beforeComboModelAttempt,
      recordComboModelOutcome,
    } = await import("../../open-sse/diepxuan/comboHooks.js");
    const { resetComboFailTracker } = await import("../../open-sse/diepxuan/comboFailTracker.js");

    const comboName = `before-combo-${Date.now()}`;
    const model = "provider/model";
    const log = { debug: vi.fn() };

    resetComboFailTracker(comboName);
    expect(beforeComboModelAttempt({ modelStr: model, comboName, log })).toEqual({ skip: false });

    recordComboModelOutcome(model, comboName, false);
    recordComboModelOutcome(model, comboName, false);
    recordComboModelOutcome(model, comboName, false);

    expect(beforeComboModelAttempt({ modelStr: model, comboName, log })).toEqual({ skip: true });
    expect(log.debug).toHaveBeenCalledWith("COMBO", `Skipping ${model} (fail count exceeded)`);
  });

  it("afterComboModelAttempt records failures and success resets the skip state", async () => {
    const {
      afterComboModelAttempt,
      beforeComboModelAttempt,
    } = await import("../../open-sse/diepxuan/comboHooks.js");
    const { resetComboFailTracker } = await import("../../open-sse/diepxuan/comboFailTracker.js");

    const comboName = `after-combo-${Date.now()}`;
    const model = "provider/model";

    resetComboFailTracker(comboName);
    afterComboModelAttempt({ modelStr: model, comboName, ok: false });
    afterComboModelAttempt({ modelStr: model, comboName, ok: false });
    expect(beforeComboModelAttempt({ modelStr: model, comboName })).toEqual({ skip: false });

    afterComboModelAttempt({ modelStr: model, comboName, ok: false });
    expect(beforeComboModelAttempt({ modelStr: model, comboName })).toEqual({ skip: true });

    afterComboModelAttempt({ modelStr: model, comboName, ok: true });
    expect(beforeComboModelAttempt({ modelStr: model, comboName })).toEqual({ skip: false });
  });

  it("skips a combo model after repeated failures and resets on success", async () => {
    const {
      recordComboModelOutcome,
      shouldSkipComboModel,
    } = await import("../../open-sse/diepxuan/comboHooks.js");
    const { resetComboFailTracker } = await import("../../open-sse/diepxuan/comboFailTracker.js");

    const comboName = `test-combo-${Date.now()}`;
    const model = "provider/model";

    resetComboFailTracker(comboName);
    expect(shouldSkipComboModel(model, comboName)).toBe(false);

    recordComboModelOutcome(model, comboName, false);
    recordComboModelOutcome(model, comboName, false);
    expect(shouldSkipComboModel(model, comboName)).toBe(false);

    recordComboModelOutcome(model, comboName, false);
    expect(shouldSkipComboModel(model, comboName)).toBe(true);

    recordComboModelOutcome(model, comboName, true);
    expect(shouldSkipComboModel(model, comboName)).toBe(false);
  });

  it("does not skip or record failures when DiepXuan is disabled", async () => {
    process.env.DIEPXUAN_ENABLED = "0";

    const {
      recordComboModelOutcome,
      shouldSkipComboModel,
    } = await import("../../open-sse/diepxuan/comboHooks.js");
    const { resetComboFailTracker } = await import("../../open-sse/diepxuan/comboFailTracker.js");

    const comboName = `disabled-combo-${Date.now()}`;
    const model = "provider/model";

    resetComboFailTracker(comboName);
    recordComboModelOutcome(model, comboName, false);
    recordComboModelOutcome(model, comboName, false);
    recordComboModelOutcome(model, comboName, false);

    expect(shouldSkipComboModel(model, comboName)).toBe(false);
  });
});
