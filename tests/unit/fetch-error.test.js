/**
 * Regression test for #1160:
 * Dashboard fetch errors must distinguish a dashboard-session 401 (no JSON
 * error body) from an upstream/provider error (explicit `error` from our API).
 */

import { describe, it, expect } from "vitest";
import { describeFetchError } from "../../src/shared/utils/fetchError.js";

describe("describeFetchError", () => {
  it("prefers an explicit API error message (upstream failure)", () => {
    expect(describeFetchError(401, "Unauthorized", "Failed to fetch models: 401")).toBe(
      "Failed to fetch models: 401"
    );
  });

  it("treats a bodyless 401 as a dashboard-session expiry, not a provider error", () => {
    const msg = describeFetchError(401, "Unauthorized");
    expect(msg).toMatch(/session expired|log in again/i);
    expect(msg).not.toBe("HTTP 401: Unauthorized");
    expect(msg).not.toContain("Unauthorized");
  });

  it("treats a bodyless 403 as a dashboard access problem", () => {
    expect(describeFetchError(403, "Forbidden")).toMatch(/access denied|log in again/i);
  });

  it("falls back to HTTP status for other errors", () => {
    expect(describeFetchError(500, "Internal Server Error")).toBe("HTTP 500: Internal Server Error");
    expect(describeFetchError(502)).toBe("HTTP 502");
  });

  it("still prefers the API error for non-auth statuses", () => {
    expect(describeFetchError(500, "Internal Server Error", "Failed to fetch models")).toBe(
      "Failed to fetch models"
    );
  });
});
