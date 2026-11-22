// errorEvents: the only on-disk record of a failed request. usageHistory stores
// successes only (status='ok'), so without this a 429/403 storm leaves no trace.
import { describe, it, expect, beforeAll } from "vitest";

let repo;

beforeAll(async () => {
  repo = await import("../../src/lib/db/repos/errorEventsRepo.js");
});

describe("errorEventsRepo — account reference", () => {
  it("hashes the account identifier instead of storing it", () => {
    const ref = repo.accountRefOf("tinanur706@gmail.com");
    expect(ref).toHaveLength(16);
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
    expect(ref, "raw identifier must never be written").not.toContain("@");
  });

  it("is stable for the same input", () => {
    expect(repo.accountRefOf("a@b.c")).toBe(repo.accountRefOf("a@b.c"));
  });

  it("separates distinct accounts", () => {
    expect(repo.accountRefOf("a@b.c")).not.toBe(repo.accountRefOf("x@y.z"));
  });

  it("returns null rather than a fabricated reference when there is no identifier", () => {
    expect(repo.accountRefOf(null)).toBe(null);
    expect(repo.accountRefOf(undefined)).toBe(null);
    expect(repo.accountRefOf("")).toBe(null);
  });
});

describe("errorEventsRepo — record shape", () => {
  it("exposes a recordErrorEvent writer", () => {
    expect(typeof repo.recordErrorEvent).toBe("function");
  });

  it("does not throw on a record with optional fields absent", () => {
    expect(() =>
      repo.recordErrorEvent({
        provider: "antigravity",
        model: "gemini-3.8-flash-high",
        connectionId: "conn-1",
        accountRef: "0123456789abcdef",
        status: 429,
        message: "Resource has been exhausted",
      }),
    ).not.toThrow();
  });

  it("accepts the quota metadata the classifier needs", () => {
    expect(() =>
      repo.recordErrorEvent({
        provider: "antigravity",
        model: "gemini-3.8-flash-high",
        connectionId: "conn-1",
        accountRef: "0123456789abcdef",
        status: 429,
        upstreamStatus: 429,
        reason: "QUOTA_EXHAUSTED",
        quotaResetDelay: "32m35s",
        quotaResetTimeStamp: new Date().toISOString(),
        retryDelay: null,
        hasMetadata: true,
        classifiedAs: "metadataCooldown",
        cooldownMs: 1955000,
        message: "Quota exhausted",
      }),
    ).not.toThrow();
  });
});
