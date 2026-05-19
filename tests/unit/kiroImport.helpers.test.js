/**
 * Unit tests for the bulk Kiro refresh-token import helpers.
 *
 * These cover the pure parsing/masking layer extracted from the route handler
 * so the logic can be exercised without spinning up a Next.js request, the
 * KiroService, or the SQLite store.
 */
import { describe, it, expect } from "vitest";
import {
  collectRefreshTokens,
  splitTokens,
  maskToken,
} from "../../src/app/api/oauth/kiro/import/helpers.js";

describe("collectRefreshTokens", () => {
  it("returns an empty array for null / non-object payloads", () => {
    expect(collectRefreshTokens(null)).toEqual([]);
    expect(collectRefreshTokens(undefined)).toEqual([]);
    expect(collectRefreshTokens("not-an-object")).toEqual([]);
    expect(collectRefreshTokens(42)).toEqual([]);
  });

  it("returns an empty array when neither field is present", () => {
    expect(collectRefreshTokens({})).toEqual([]);
    expect(collectRefreshTokens({ refreshToken: 123 })).toEqual([]);
  });

  it("accepts the legacy single-token shape", () => {
    expect(collectRefreshTokens({ refreshToken: "aorAAAAAG-token-1" }))
      .toEqual(["aorAAAAAG-token-1"]);
  });

  it("trims surrounding whitespace from a single token", () => {
    expect(collectRefreshTokens({ refreshToken: "  aorAAAAAG-token-1  " }))
      .toEqual(["aorAAAAAG-token-1"]);
  });

  it("splits a refreshToken string on whitespace, commas, and semicolons", () => {
    expect(
      collectRefreshTokens({
        refreshToken: "aorAAAAAG-1\naorAAAAAG-2 aorAAAAAG-3,aorAAAAAG-4;aorAAAAAG-5",
      })
    ).toEqual([
      "aorAAAAAG-1",
      "aorAAAAAG-2",
      "aorAAAAAG-3",
      "aorAAAAAG-4",
      "aorAAAAAG-5",
    ]);
  });

  it("accepts an array refreshTokens shape", () => {
    expect(
      collectRefreshTokens({
        refreshTokens: ["aorAAAAAG-1", "aorAAAAAG-2"],
      })
    ).toEqual(["aorAAAAAG-1", "aorAAAAAG-2"]);
  });

  it("ignores non-string entries inside the refreshTokens array", () => {
    expect(
      collectRefreshTokens({
        refreshTokens: ["aorAAAAAG-1", null, 42, "aorAAAAAG-2", undefined],
      })
    ).toEqual(["aorAAAAAG-1", "aorAAAAAG-2"]);
  });

  it("accepts a string refreshTokens shape and splits it", () => {
    expect(
      collectRefreshTokens({
        refreshTokens: "aorAAAAAG-1\n\naorAAAAAG-2",
      })
    ).toEqual(["aorAAAAAG-1", "aorAAAAAG-2"]);
  });

  it("merges both fields when present", () => {
    expect(
      collectRefreshTokens({
        refreshTokens: ["aorAAAAAG-1"],
        refreshToken: "aorAAAAAG-2 aorAAAAAG-3",
      })
    ).toEqual(["aorAAAAAG-1", "aorAAAAAG-2", "aorAAAAAG-3"]);
  });

  it("deduplicates tokens (first occurrence wins)", () => {
    expect(
      collectRefreshTokens({
        refreshTokens: ["aorAAAAAG-1", "aorAAAAAG-1", "aorAAAAAG-2"],
        refreshToken: "aorAAAAAG-2",
      })
    ).toEqual(["aorAAAAAG-1", "aorAAAAAG-2"]);
  });

  it("drops empty strings and whitespace-only entries", () => {
    expect(
      collectRefreshTokens({
        refreshTokens: ["", "   ", "aorAAAAAG-1", "\t\n"],
      })
    ).toEqual(["aorAAAAAG-1"]);
  });
});

describe("splitTokens", () => {
  it("splits on mixed separators", () => {
    expect(splitTokens("a b\nc\td,e;f")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("collapses runs of separators", () => {
    expect(splitTokens("a,,;\n\n b")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty / whitespace-only string", () => {
    expect(splitTokens("")).toEqual([]);
    expect(splitTokens("   \n\t")).toEqual([]);
  });
});

describe("maskToken", () => {
  it("returns *** for short or non-string values", () => {
    expect(maskToken("")).toBe("***");
    expect(maskToken("short")).toBe("***");
    expect(maskToken(null)).toBe("***");
    expect(maskToken(undefined)).toBe("***");
    expect(maskToken(12345)).toBe("***");
    // Exactly 11 chars is below the 12-char threshold.
    expect(maskToken("12345678901")).toBe("***");
  });

  it("keeps the leading 8 chars and trailing 4 chars for full tokens", () => {
    // 12-char minimum: prefix(8) + suffix(4)
    expect(maskToken("aorAAAAAGabcd")).toBe("aorAAAAA…abcd");
    expect(
      maskToken("aorAAAAAG-this-is-a-much-longer-refresh-token-XXXX")
    ).toBe("aorAAAAA…XXXX");
  });
});
