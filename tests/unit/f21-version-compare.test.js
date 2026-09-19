// F21'/T1.6-H1: the dashboard /api/version update notice was dead on every fork build
// because the old compare did Number("75-enhanced") -> NaN and every NaN comparison is
// false. Commit 943b8f82 fixed exactly this in cli/cli.js by comparing the numeric base
// and refusing to call a same-base official release "newer" than a fork build. This
// mirrors that matrix onto the server copy, and adds fork build-suffix ordering
// (0.5.75-enhanced.2 is newer than 0.5.75-enhanced.1 — the CLI base-only compare calls
// them equal; the dashboard must still surface a newer fork release of the same base).
import { describe, it, expect } from "vitest";

const { compareVersions } = await import("@/app/api/version/route.js").then((m) => m.__test__);

describe("/api/version compareVersions (943b8f82 mirror + fork suffix)", () => {
  it("sees a bumped patch upstream release as newer than a fork build", () => {
    // The dead-notice case from T1.6-H1: hasUpdate must be true here.
    expect(compareVersions("0.5.76", "0.5.75-enhanced.1")).toBe(1);
  });

  it("mirrors 943b8f82: 0.5.77 and 0.5.80 are seen as newer, 0.5.76 is not", () => {
    expect(compareVersions("0.5.77", "0.5.76-enhanced.1")).toBe(1);
    expect(compareVersions("0.5.80", "0.5.76-enhanced.1")).toBe(1);
    expect(compareVersions("0.5.76", "0.5.76-enhanced.1")).toBe(0);
  });

  it("does not treat the official release of the same base as an upgrade over the fork", () => {
    expect(compareVersions("0.5.75", "0.5.75-enhanced.1")).toBe(0);
    expect(compareVersions("0.5.76-rc.1", "0.5.76")).toBe(0);
  });

  it("orders fork build suffixes numerically on an equal base", () => {
    expect(compareVersions("0.5.75-enhanced.2", "0.5.75-enhanced.1")).toBe(1);
    expect(compareVersions("0.5.75-enhanced.1", "0.5.75-enhanced.2")).toBe(-1);
    expect(compareVersions("0.5.75-enhanced.10", "0.5.75-enhanced.9")).toBe(1);
    expect(compareVersions("0.5.75-enhanced.1", "0.5.75-enhanced.1")).toBe(0);
  });

  it("compares numeric bases segment by segment, never lexicographically", () => {
    expect(compareVersions("0.5.9", "0.5.10")).toBe(-1);
    expect(compareVersions("0.5.10", "0.5.9")).toBe(1);
    expect(compareVersions("0.6.0", "0.5.99")).toBe(1);
  });

  it("treats plain versions the way the old compare did when no suffix is involved", () => {
    expect(compareVersions("0.5.75", "0.5.75")).toBe(0);
    expect(compareVersions("0.5.75.0", "0.5.75")).toBe(0);
    expect(compareVersions("0.5.76", "0.5.75")).toBe(1);
    expect(compareVersions("0.4.9", "0.5.0")).toBe(-1);
  });

  it("is never NaN-blind: unparsable segments behave as zero, comparisons stay decidable", () => {
    expect(compareVersions("abc", "0.0.1")).toBe(-1);
    expect(compareVersions("0.5.76", "garbage")).toBe(1);
    expect(compareVersions("", "")).toBe(0);
    expect(compareVersions("0.5.x", "0.5.76")).toBe(-1);
  });

  it("ignores a leading v and surrounding whitespace", () => {
    expect(compareVersions(" v0.5.76 ", "0.5.75-enhanced.1")).toBe(1);
  });
});
