import { describe, expect, it } from "vitest";
import { getStatusVariant, formatOnHoldRemaining } from "../../src/shared/utils/connectionStatus.js";

describe("getStatusVariant", () => {
  it("maps parked keys to warning", () => {
    expect(getStatusVariant(true, "on hold")).toBe("warning");
  });

  it("keeps existing mappings", () => {
    expect(getStatusVariant(true, "active")).toBe("success");
    expect(getStatusVariant(true, "success")).toBe("success");
    expect(getStatusVariant(true, "error")).toBe("error");
    expect(getStatusVariant(true, "expired")).toBe("error");
    expect(getStatusVariant(true, "unavailable")).toBe("error");
    expect(getStatusVariant(false, "active")).toBe("default");
    expect(getStatusVariant(true, "something-else")).toBe("default");
  });
});

describe("formatOnHoldRemaining", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatOnHoldRemaining(22000)).toBe("22s");
    expect(formatOnHoldRemaining(5 * 60000 + 3000)).toBe("5m 3s");
    expect(formatOnHoldRemaining(2 * 3600000 + 5 * 60000)).toBe("2h 5m");
  });

  it("returns null when the wait is over", () => {
    expect(formatOnHoldRemaining(0)).toBeNull();
    expect(formatOnHoldRemaining(-1000)).toBeNull();
    expect(formatOnHoldRemaining(null)).toBeNull();
    expect(formatOnHoldRemaining(undefined)).toBeNull();
  });
});
