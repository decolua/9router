import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn((body, init) => Response.json(body, init)) },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeys: vi.fn(),
}));

vi.mock("@/shared/constants/config", () => ({
  UPDATER_CONFIG: { appPort: 20128 },
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(),
}));

import { isTimeoutError } from "../../src/app/api/models/test/route.js";

describe("model test timeout classification", () => {
  it("distinguishes timeout errors from auth and server failures", () => {
    expect(
      isTimeoutError(
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      ),
    ).toBe(true);
    expect(
      isTimeoutError(new DOMException("The operation timed out", "AbortError")),
    ).toBe(true);
    expect(isTimeoutError(new Error("HTTP 401: Unauthorized"))).toBe(false);
    expect(isTimeoutError(new Error("HTTP 500: upstream failed"))).toBe(false);
  });
});
