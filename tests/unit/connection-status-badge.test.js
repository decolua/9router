import { describe, expect, it } from "vitest";
import { getStatusVariant } from "../../src/shared/utils/connectionStatus.js";

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
