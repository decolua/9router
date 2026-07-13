// Tests for Windows path support in the `find` filter + autodetect
// Windows absolute paths ("C:\Users\me\src\a.js") carry a drive-letter
// separator that the Unix-only colon check used to reject, so no compaction
// happened for Windows `find`-style dumps. See fix(rtk/find).
import { describe, it, expect } from "vitest";
import { autoDetectFilter } from "../../open-sse/rtk/autodetect.js";
import { find } from "../../open-sse/rtk/filters/find.js";
import { grep } from "../../open-sse/rtk/filters/grep.js";

const WIN_PATHS = [
  "C:\\Users\\me\\project\\src\\a.js",
  "C:\\Users\\me\\project\\src\\b.js",
  "C:\\Users\\me\\project\\src\\c.js"
].join("\n");

const UNIX_PATHS = [
  "./src/a.js",
  "./src/b.js",
  "./src/c.js"
].join("\n");

describe("Windows find-path detection", () => {
  it("detects Windows drive-letter paths as `find`", () => {
    expect(autoDetectFilter(WIN_PATHS)).toBe(find);
  });

  it("still detects Unix paths as `find` (no regression)", () => {
    expect(autoDetectFilter(UNIX_PATHS)).toBe(find);
  });

  it("still routes a Windows file:line dump to a compacting filter", () => {
    const input = [
      "C:\\Users\\me\\project\\src\\a.js:10:const x = 1",
      "C:\\Users\\me\\project\\src\\b.js:20:const y = 2",
      "C:\\Users\\me\\project\\src\\c.js:30:const z = 3"
    ].join("\n");
    // Each line is grep-shaped (file:line:content), so it routes to `grep`
    // — but a drive-letter-only dump would route to `find`. Both are
    // compaction-positive, so either is acceptable here.
    const f = autoDetectFilter(input);
    expect(f).not.toBeNull();
    expect([find, grep]).toContain(f);
  });
});

describe("Windows find-path grouping", () => {
  it("groups Windows backslash paths and normalizes to forward slashes", () => {
    const out = find(WIN_PATHS);
    expect(out).toContain("3 files in 1 dirs");
    expect(out).toContain("C:/Users/me/project/src/");
    expect(out).toContain("a.js");
    expect(out).toContain("b.js");
    expect(out).toContain("c.js");
    // backslashes must not leak into output
    expect(out).not.toContain("\\");
  });

  it("compresses the dump (output shorter than input)", () => {
    const out = find(WIN_PATHS);
    expect(out.length).toBeLessThan(WIN_PATHS.length);
  });
});
