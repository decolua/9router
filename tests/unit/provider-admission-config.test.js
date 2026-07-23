import { describe, expect, it } from "vitest";

import {
  PROVIDER_ADMISSION_DEFAULTS,
  ProviderAdmissionConfigError,
  resolveProviderAdmissionConfig,
  validateProviderAdmissionConfig,
} from "../../src/shared/config/providerAdmission.js";

describe("provider admission configuration", () => {
  it("resolves missing configuration to fresh disabled defaults", () => {
    const first = resolveProviderAdmissionConfig(undefined);
    const second = resolveProviderAdmissionConfig(null);

    expect(first).toEqual(PROVIDER_ADMISSION_DEFAULTS);
    expect(second).toEqual(PROVIDER_ADMISSION_DEFAULTS);
    expect(first).not.toBe(PROVIDER_ADMISSION_DEFAULTS);
    expect(first).not.toBe(second);
  });

  it("accepts inclusive boundary values", () => {
    expect(resolveProviderAdmissionConfig({
      enabled: true,
      maxInFlightPerAccount: 100,
      maxQueueSize: 0,
      queueTimeoutMs: 100,
    })).toEqual({
      enabled: true,
      maxInFlightPerAccount: 100,
      maxQueueSize: 0,
      queueTimeoutMs: 100,
    });

    expect(resolveProviderAdmissionConfig({
      maxInFlightPerAccount: 1,
      maxQueueSize: 5000,
      queueTimeoutMs: 300000,
    })).toEqual({
      ...PROVIDER_ADMISSION_DEFAULTS,
      maxInFlightPerAccount: 1,
      maxQueueSize: 5000,
      queueTimeoutMs: 300000,
    });
  });

  it.each([
    [{ enabled: "true" }, "enabled", "invalid_boolean"],
    [{ maxInFlightPerAccount: 0 }, "maxInFlightPerAccount", "out_of_range"],
    [{ maxInFlightPerAccount: 1.5 }, "maxInFlightPerAccount", "invalid_integer"],
    [{ maxQueueSize: -1 }, "maxQueueSize", "out_of_range"],
    [{ queueTimeoutMs: Infinity }, "queueTimeoutMs", "invalid_integer"],
    [{ queueTimeoutMs: 99 }, "queueTimeoutMs", "out_of_range"],
    [{ unexpected: true }, "unexpected", "unknown_field"],
  ])("rejects invalid config %j", (input, field, code) => {
    const result = validateProviderAdmissionConfig(input);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ field, code }));
    expect(() => resolveProviderAdmissionConfig(input)).toThrow(ProviderAdmissionConfigError);
  });

  it("supports partial validation without injecting defaults", () => {
    const result = validateProviderAdmissionConfig(
      { maxQueueSize: 12 },
      { partial: true },
    );

    expect(result).toEqual({
      ok: true,
      value: { maxQueueSize: 12 },
      errors: [],
      missing: false,
    });
  });

  it("rejects non-object configuration", () => {
    const result = validateProviderAdmissionConfig("enabled");

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: "admission",
        code: "invalid_object",
      }),
    ]);
  });
});
