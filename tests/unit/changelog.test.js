import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  collectChangelogHighlights,
  compareSemver,
  detectPostUpdate,
  dismissPostUpdate,
  getChangelogSectionsBetween,
  markUpdateStarting,
  parseChangelogSections,
  stripInlineMarkdown,
  CHANGELOG_STORAGE,
} from "../../src/shared/utils/changelog.js";

const SAMPLE = `# v0.5.31 (2026-07-13)

## Features
- **Updater**: one-click Update in dashboard
- **CLI tools**: add Grok Build setup

## Fixes
- **Grok CLI**: parse SuperGrok percent-based billing

# v0.5.30 (2026-07-10)

## Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)

## Fixes
- **Codex**: avoid bare-email OAuth dedup (#2477)

# v0.5.20 (2026-07-07)

## Features
- **Thinking**: per-model thinking level picker
`;

describe("compareSemver", () => {
  it("orders versions", () => {
    expect(compareSemver("0.5.31", "0.5.30")).toBe(1);
    expect(compareSemver("0.5.30", "0.5.31")).toBe(-1);
    expect(compareSemver("0.5.30", "v0.5.30")).toBe(0);
  });
});

describe("parseChangelogSections", () => {
  it("parses version sections and bullets", () => {
    const sections = parseChangelogSections(SAMPLE);
    expect(sections).toHaveLength(3);
    expect(sections[0].version).toBe("0.5.31");
    expect(sections[0].bullets.length).toBeGreaterThanOrEqual(3);
    expect(sections[1].version).toBe("0.5.30");
  });
});

describe("getChangelogSectionsBetween", () => {
  it("returns only versions after from and up to to", () => {
    const range = getChangelogSectionsBetween(SAMPLE, "0.5.30", "0.5.31");
    expect(range.map((s) => s.version)).toEqual(["0.5.31"]);
  });

  it("includes multiple hops", () => {
    const range = getChangelogSectionsBetween(SAMPLE, "0.5.20", "0.5.31");
    expect(range.map((s) => s.version)).toEqual(["0.5.31", "0.5.30"]);
  });

  it("returns empty when already on version", () => {
    const range = getChangelogSectionsBetween(SAMPLE, "0.5.31", "0.5.31");
    expect(range).toEqual([]);
  });
});

describe("collectChangelogHighlights", () => {
  it("flattens and truncates bullets", () => {
    const sections = getChangelogSectionsBetween(SAMPLE, "0.5.20", "0.5.31");
    const { bullets, truncated, versions } = collectChangelogHighlights(sections, {
      maxBullets: 2,
    });
    expect(bullets).toHaveLength(2);
    expect(truncated).toBe(true);
    expect(versions).toContain("0.5.31");
    expect(bullets[0].text).not.toMatch(/\*\*/);
  });
});

describe("stripInlineMarkdown", () => {
  it("strips bold and code", () => {
    expect(stripInlineMarkdown("**Grok CLI**: `fix`")).toBe("Grok CLI: fix");
  });
});

describe("post-update storage", () => {
  beforeEach(() => {
    const store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
  });

  it("seeds lastSeen on first visit without banner", () => {
    const d = detectPostUpdate("0.5.30");
    expect(d.show).toBe(false);
    expect(localStorage.getItem(CHANGELOG_STORAGE.lastSeenVersion)).toBe("0.5.30");
  });

  it("shows banner after markUpdateStarting + version bump", () => {
    markUpdateStarting("0.5.30");
    const d = detectPostUpdate("0.5.31");
    expect(d.show).toBe(true);
    expect(d.fromVersion).toBe("0.5.30");
    expect(d.toVersion).toBe("0.5.31");
    dismissPostUpdate("0.5.31");
    expect(detectPostUpdate("0.5.31").show).toBe(false);
  });
});
