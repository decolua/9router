import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

describe("KiroExecutor error parsing", () => {
  const executor = new KiroExecutor();

  it("should parse 402 MONTHLY_REQUEST_COUNT error and set resetsAtMs to next month", () => {
    const response = { status: 402 };
    const bodyText = JSON.stringify({
      message: "You have reached the limit.",
      reason: "MONTHLY_REQUEST_COUNT"
    });

    const now = new Date();
    // Calculate expected next month timestamp
    const expectedNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();

    const parsed = executor.parseError(response, bodyText);
    expect(parsed.status).toBe(402);
    expect(parsed.message).toContain("You have reached the limit.");
    expect(parsed.resetsAtMs).toBeDefined();
    // Allow small delta in case tests run exactly at millisecond boundary, but since we use start of month it's static
    expect(parsed.resetsAtMs).toBe(expectedNextMonth);
  });

  it("should fall back to next month if status is 402 but JSON is invalid", () => {
    const response = { status: 402 };
    const bodyText = "Invalid JSON structure with MONTHLY_REQUEST_COUNT";

    const now = new Date();
    const expectedNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).getTime();

    const parsed = executor.parseError(response, bodyText);
    expect(parsed.status).toBe(402);
    expect(parsed.resetsAtMs).toBe(expectedNextMonth);
  });

  it("should not set resetsAtMs for other non-402 errors", () => {
    const response = { status: 400 };
    const bodyText = JSON.stringify({
      message: "Some bad request error"
    });

    const parsed = executor.parseError(response, bodyText);
    expect(parsed.status).toBe(400);
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});
