import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import commitMetadataByVersion from "../../src/shared/components/changelogCommitMetadata.json";
import {
  commitCountFromTitle,
  commitMetadataForTitle,
  formatCommitTimestamp,
  formatVersionDate,
  versionFromTitle,
} from "../../src/shared/components/changelogVersionMetadata.js";

const changelog = readFileSync(resolve(__dirname, "../../CHANGELOG.md"), "utf8");

describe("changelog version commit metadata", () => {
  it("keeps product release numbers out of changelog headings", () => {
    const headings = changelog.split("\n").filter((line) => /^#\s/.test(line));

    expect(headings.length).toBeGreaterThan(300);
    expect(headings.filter((line) => /\bv?\d+(?:\.\d+){2,}\b/i.test(line))).toEqual([]);
  });

  it("keeps model, runtime, and dependency release numbers out of changelog copy", () => {
    const forbiddenPatterns = [
      /\b(?:GPT|Gemini|Claude|DeepSeek|GLM|Kimi|Grok|Qwen|MiniMax|MiMo)\s+(?:[VRK]\s*)?\d+(?:[.-]\d+)*\b/i,
      /\b(?:Haiku|Sonnet|Opus)\s+\d+(?:[.-]\d+)*\b/i,
      /\b(?:gpt|gemini|claude|deepseek|glm|kimi|grok|qwen|mimo|muse-spark)(?:-[a-z]+)*-(?:v|r|k)?\d+(?:[.-]\d+)*[a-z]?(?:-[a-z0-9]+)*\b/i,
      /\b(?:Node(?:\.js)?|Next(?:\.js)?|npm|undici|OpenCode(?: CLI)?|Claude (?:CLI|Code)|Antigravity IDE)\s+v?\d+(?:\.\d+){1,2}\b/i,
      /\b(?:version|release)\s+(?:v)?\d+(?:\.\d+){1,2}\b/i,
      /\bNode\s*<\s*22\b/i,
    ];
    const forbidden = changelog
      .split("\n")
      .filter((line) => forbiddenPatterns.some((pattern) => pattern.test(line)));

    expect(forbidden).toEqual([]);
  });

  it("maps every version to a full commit SHA and valid timestamp", () => {
    expect(Object.keys(commitMetadataByVersion).length).toBeGreaterThan(300);
    for (const metadata of Object.values(commitMetadataByVersion)) {
      expect(metadata.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(Number.isFinite(new Date(metadata.committedAt).getTime())).toBe(true);
    }
  });

  it("extracts a version without mistaking a date for one", () => {
    expect(versionFromTitle("v0.5.420 (2026-11-11) · 2 commits")).toBe("0.5.420");
    expect(versionFromTitle("2026-11-20 Preview (0 commits)")).toBe("");
  });

  it("looks up metadata from a version heading", () => {
    expect(commitMetadataForTitle("v0.5.420 (2026-11-11)")).toEqual(commitMetadataByVersion["0.5.420"]);
    expect(commitMetadataForTitle("Preview without a version")).toBeNull();
  });

  it("formats the commit timestamp as a complete UTC date and time", () => {
    const formatted = formatCommitTimestamp("2026-11-11T08:13:14Z");
    expect(formatted).toContain("11 November 2026");
    expect(formatted).toContain("08:13");
    expect(formatted).toContain("UTC");
    expect(formatCommitTimestamp("not-a-timestamp")).toBe("");
  });

  it("formats version headings as English day-month-year dates", () => {
    expect(formatVersionDate("v0.5.420 (2026-11-11)", "2026-11-13T08:13:14Z")).toBe("11 November 2026");
    expect(formatVersionDate("v0.5.420", "2026-11-11T08:13:14Z")).toBe("11 November 2026");
    expect(formatVersionDate("22-11-2026")).toBe("22 November 2026");
    expect(formatVersionDate("v0.5.420", "not-a-timestamp")).toBe("");
  });

  it("parses singular, plural, and explicit zero commit counts", () => {
    expect(commitCountFromTitle("v0.5.420 · 1 commit")).toBe(1);
    expect(commitCountFromTitle("v0.5.419 · 12 commits")).toBe(12);
    expect(commitCountFromTitle("2026-11-20 Preview (0 commits)")).toBe(0);
    expect(commitCountFromTitle("v0.5.418")).toBeNull();
  });
});
