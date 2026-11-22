import { describe, it, expect } from "vitest";
import { resolveExhaustedStatus, unavailableResponse } from "../open-sse/utils/error.js";

// #4663 — allRateLimited relabelled a genuine upstream 429 as a synthetic 503.
// The envelope must relay a recoverable upstream status and keep 503 for the
// case it actually describes (no usable upstream code at all).
describe("resolveExhaustedStatus (#4663)", () => {
  it("propagates a real upstream 429 instead of relabelling it as 503", () => {
    expect(resolveExhaustedStatus(429, null)).toBe(429);
  });

  it("propagates 429 carried by the cooldown layer when no hop status is known", () => {
    expect(resolveExhaustedStatus(null, 429)).toBe(429);
  });

  it("prefers the last hop status over the cooldown layer", () => {
    expect(resolveExhaustedStatus(429, 403)).toBe(429);
  });

  it("propagates other recoverable statuses (409 model exhaustion, 403 auth)", () => {
    expect(resolveExhaustedStatus(409, null)).toBe(409);
    expect(resolveExhaustedStatus(403, null)).toBe(403);
  });

  it("accepts the cooldown code as a numeric string", () => {
    expect(resolveExhaustedStatus(null, "429")).toBe(429);
  });

  it("falls back to 503 when genuinely no upstream code exists", () => {
    expect(resolveExhaustedStatus(null, null)).toBe(503);
    expect(resolveExhaustedStatus(undefined, undefined)).toBe(503);
    expect(resolveExhaustedStatus(null, "")).toBe(503);
  });

  it("keeps an unrecoverable upstream 5xx rather than inventing 503", () => {
    expect(resolveExhaustedStatus(500, null)).toBe(500);
  });

  it("ignores non-numeric junk from the cooldown layer", () => {
    expect(resolveExhaustedStatus(null, "banana")).toBe(503);
  });
});

describe("unavailableResponse status plumbing (#4663)", () => {
  it("sends the propagated status and keeps retry-after readable", async () => {
    const resetAt = new Date(Date.now() + 30_000).toISOString();
    const res = unavailableResponse(429, "[prov/model] RateLimitExceeded", resetAt, "reset after 30s");

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = await res.json();
    expect(body.error.message).toContain("RateLimitExceeded");
    expect(body.error.message).toContain("reset after 30s");
  });

  it("still produces 503 when the resolver had nothing to propagate", () => {
    const status = resolveExhaustedStatus(null, null);
    const resetAt = new Date(Date.now() + 1000).toISOString();
    expect(unavailableResponse(status, "down", resetAt, "soon").status).toBe(503);
  });
});
