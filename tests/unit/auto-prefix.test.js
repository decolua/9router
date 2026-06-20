import { describe, it, expect } from "vitest";
import { parseAutoPrefix, VALID_VARIANTS } from "../../open-sse/services/autoCombo/autoPrefix.js";

describe("parseAutoPrefix", () => {
  it('"auto" → valid default (no variant)', () => {
    expect(parseAutoPrefix("auto")).toEqual({ valid: true });
  });

  it('"auto/" → valid default (trailing slash = no variant)', () => {
    expect(parseAutoPrefix("auto/")).toEqual({ valid: true });
  });

  it("each VALID_VARIANTS parses under auto/", () => {
    for (const v of VALID_VARIANTS) {
      expect(parseAutoPrefix(`auto/${v}`)).toEqual({ valid: true, variant: v });
    }
  });

  it('"autocoding" (no slash) → invalid format', () => {
    const r = parseAutoPrefix("autocoding");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/format/i);
  });

  it("non-auto model → not an auto-prefixed model", () => {
    const r = parseAutoPrefix("gpt-4o");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/not an auto/i);
  });

  it("unknown variant → invalid variant error names it", () => {
    const r = parseAutoPrefix("auto/bogus");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("bogus");
  });

  it("too many slashes → invalid format", () => {
    expect(parseAutoPrefix("auto/coding/extra").valid).toBe(false);
  });

  it("null / undefined / non-string → not auto-prefixed", () => {
    expect(parseAutoPrefix(null).valid).toBe(false);
    expect(parseAutoPrefix(undefined).valid).toBe(false);
    expect(parseAutoPrefix(123).valid).toBe(false);
  });

  it("VALID_VARIANTS is the 6 documented variants", () => {
    expect(VALID_VARIANTS).toEqual(["coding", "fast", "cheap", "offline", "smart", "lkgp"]);
  });
});
