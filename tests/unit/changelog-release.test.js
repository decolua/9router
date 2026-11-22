import { describe, expect, it } from "vitest";
import { compareDateReleases, releaseFromHeading } from "../../src/lib/changelogRelease.mjs";

describe("update release markers", () => {
  it("normalizes dated changelog headings and preserves legacy version headings", () => {
    expect(releaseFromHeading("22-11-2026" )).toBe("2026-11-22");
    expect(releaseFromHeading("2026-11-21 Preview")).toBe("2026-11-21");
    expect(releaseFromHeading("v0.5.420 (2026-11-11)")).toBe("v0.5.420");
    expect(releaseFromHeading("unrelated heading")).toBe("");
  });

  it("compares dates without treating different formats as semantic versions", () => {
    expect(compareDateReleases("2026-11-22", "2026-11-21")).toBe(1);
    expect(compareDateReleases("2026-11-21", "2026-11-22")).toBe(-1);
    expect(compareDateReleases("2026-11-22", "2026-11-22")).toBe(0);
    expect(compareDateReleases("2026-11-22", "v0.5.420")).toBeNull();
    expect(compareDateReleases("v0.5.420", "v0.5.419")).toBeUndefined();
  });
});
