import { describe, expect, it } from "vitest";
import undiciPackage from "undici/package.json" with { type: "json" };
import hpmPackage from "http-proxy-middleware/package.json" with { type: "json" };

const parse = (value) => value.split(".").map(Number);
const atLeast = (actual, minimum) => {
  const a = parse(actual);
  const b = parse(minimum);
  return a[0] > b[0]
    || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
};

describe("proxy dependency security floors", () => {
  it("uses undici 7.28.0 or newer", () => {
    expect(atLeast(undiciPackage.version, "7.28.0")).toBe(true);
  });

  it("uses http-proxy-middleware 3.0.7 or newer", () => {
    expect(atLeast(hpmPackage.version, "3.0.7")).toBe(true);
  });
});
