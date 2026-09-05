import { describe, it, expect } from "vitest";
import { normalizeCustomHeaders } from "@/lib/customHeaders.js";

describe("normalizeCustomHeaders", () => {
  it("passes valid headers through, trimming names", () => {
    const { headers, error } = normalizeCustomHeaders([{ name: " X-A ", value: "v" }]);
    expect(error).toBeNull();
    expect(headers).toEqual([{ name: "X-A", value: "v", ttlMinutes: null }]);
  });
  it("drops empty-name rows", () => {
    const { headers } = normalizeCustomHeaders([{ name: "  ", value: "x" }, { name: "Keep", value: "y" }]);
    expect(headers).toEqual([{ name: "Keep", value: "y", ttlMinutes: null }]);
  });
  it("defaults missing value to empty string", () => {
    const { headers } = normalizeCustomHeaders([{ name: "X" }]);
    expect(headers).toEqual([{ name: "X", value: "", ttlMinutes: null }]);
  });
  it("dedupes case-insensitively, last wins", () => {
    const { headers } = normalizeCustomHeaders([{ name: "User-Agent", value: "a" }, { name: "user-agent", value: "b" }]);
    expect(headers).toEqual([{ name: "user-agent", value: "b", ttlMinutes: null }]);
  });
  it("rejects invalid header name", () => {
    const { headers, error } = normalizeCustomHeaders([{ name: "Bad Header", value: "v" }]);
    expect(error).toBeTruthy();
    expect(headers).toEqual([]);
  });
  it("rejects CR/LF in header value", () => {
    const { headers, error } = normalizeCustomHeaders([{ name: "X", value: "foo\r\nX-Injected: bar" }]);
    expect(error).toBeTruthy();
    expect(headers).toEqual([]);
  });
  it("non-array input → none, no error", () => {
    expect(normalizeCustomHeaders(undefined)).toEqual({ headers: [], error: null });
    expect(normalizeCustomHeaders(null)).toEqual({ headers: [], error: null });
  });
});

describe("normalizeCustomHeaders — ttlMinutes", () => {
  it("preserves null (absent) as null", () => {
    const { headers } = normalizeCustomHeaders([{ name: "X", value: "v" }]);
    expect(headers[0].ttlMinutes).toBeNull();
  });
  it("preserves 0 (permanent)", () => {
    const { headers } = normalizeCustomHeaders([{ name: "X", value: "v", ttlMinutes: 0 }]);
    expect(headers[0].ttlMinutes).toBe(0);
  });
  it("preserves a positive integer", () => {
    const { headers } = normalizeCustomHeaders([{ name: "X", value: "v", ttlMinutes: 30 }]);
    expect(headers[0].ttlMinutes).toBe(30);
  });
  it("coerces negative / NaN / non-integer / wrong-type to null (no error)", () => {
    for (const bad of [-5, 1.5, NaN, "abc", "10", {}]) {
      const { headers, error } = normalizeCustomHeaders([{ name: "X", value: "v", ttlMinutes: bad }]);
      expect(error).toBeNull();
      expect(headers[0].ttlMinutes).toBeNull();
    }
  });
});
