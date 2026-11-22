import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const modal = readFileSync(resolve(root, "src/shared/components/ChangelogModal.js"), "utf8");
const changelog = readFileSync(resolve(root, "CHANGELOG.md"), "utf8");
const glyphs = readFileSync(resolve(root, "public/fonts/material-symbols-glyphs.txt"), "utf8");

// Rebuilt here rather than imported: the modal is JSX behind an alias chain, so
// importing it needs a bundle step. The alias table and the canonicaliser are
// plain strings, which is exactly what they are.
const aliasSlice = modal.slice(modal.indexOf("const CATEGORY_ALIAS"), modal.indexOf('// "Sync with upstream'));
const CATEGORY_ALIAS = new Function(aliasSlice + "\nreturn CATEGORY_ALIAS;")();

const canonSlice = modal.slice(modal.indexOf("function canonicalCategory"), modal.indexOf("const CATEGORY_STYLE"));
const canonicalCategory = new Function(
  "CATEGORY_ALIAS",
  canonSlice + "\nreturn canonicalCategory;"
)(CATEGORY_ALIAS);

const styleSlice = modal.slice(modal.indexOf("const CATEGORY_STYLE"), modal.indexOf("function categoryStyle"));
const CATEGORY_STYLE = new Function(styleSlice + "\nreturn CATEGORY_STYLE;")();

const styleFor = new Function(
  "canonicalCategory",
  "CATEGORY_STYLE",
  modal.slice(modal.indexOf("function categoryStyle"), modal.indexOf("// The leading verb")) +
    "\nreturn categoryStyle;"
)(canonicalCategory, CATEGORY_STYLE);

const verbSlice = modal.slice(modal.indexOf("const CHANGE_VERB"), modal.indexOf("function changeKind"));
const CHANGE_VERB = new Function(verbSlice + "\nreturn CHANGE_VERB;")();

const styleIconSlice = modal.slice(modal.indexOf("icon: \"label\""), modal.indexOf("function renderBody"));
const FALLBACK_ICON = /icon:\s*"([a-z_0-9]+)"/.exec(styleIconSlice)?.[1];

const shipped = new Set(
  glyphs.split("\n").map((s) => s.trim()).filter(Boolean)
);

const h2 = [...changelog.matchAll(/^## (.+?)\s*$/gm)].map((m) => m[1].trim());
const h1body = [...changelog.matchAll(/^# .+?$/gm)].length;

describe("changelog: every category is recognised and drawn", () => {
  it("the file really carries categories to check", () => {
    expect(h1body).toBeGreaterThan(10);
    expect(h2.length).toBeGreaterThan(20);
  });

  it("no heading in CHANGELOG.md renders with the unknown-category fallback", () => {
    const grey = h2.filter((h) => {
      const st = styleFor(h);
      return st.icon === FALLBACK_ICON && st.color === "#94a3b8";
    });
    expect(grey).toEqual([]);
  });

  it("every category that can be rendered has its own style entry", () => {
    const missing = [...new Set(h2)]
      .filter((h) => !/^sync with upstream\b/i.test(h))
      .filter((h) => {
        const name = canonicalCategory(h);
        return !CATEGORY_STYLE[name];
    });
    expect(missing).toEqual([]);
  });

  it("all rendered categories and the unknown fallback use WHAT'S wording", () => {
    for (const key of Object.keys(CATEGORY_STYLE)) {
      expect(styleFor(key).question).toMatch(/^WHAT'S /);
    }
    expect(styleFor("Unmapped heading").question).toMatch(/^WHAT'S /);
  });

  it("does not retain raw category headings that begin with WHAT but omit the apostrophe", () => {
    const oldWhatStyle = h2.filter((heading) => /^What(?:\s|$)/i.test(heading));
    expect(oldWhatStyle).toEqual([]);
  });

  it("uses WHAT'S ADDED for the UI category", () => {
    expect(styleFor("UI").question).toBe("WHAT'S ADDED?");
  });

  it("the reader-facing headings the fork writes map to a coloured category", () => {
    for (const h of ["What's New", "What's Changed", "What's Fixed", "What's Removed", "What's Undone"]) {
      const st = styleFor(h);
      expect(st.icon).not.toBe(FALLBACK_ICON);
      expect(st.color).not.toBe("#94a3b8");
    }
  });
});

describe("changelog icons are carried by the shipped subset font", () => {
  const used = new Set([
    ...[...styleSlice.matchAll(/icon:\s*"([a-z_0-9]+)"/g)].map((m) => m[1]),
    ...CHANGE_VERB.map((v) => v.icon),
    FALLBACK_ICON,
  ].filter(Boolean));

  it("names every icon it can draw", () => {
    expect(used.size).toBeGreaterThanOrEqual(10);
  });

  it("has no icon missing from material-symbols-glyphs.txt", () => {
    const missing = [...used].filter((i) => !shipped.has(i)).sort();
    expect(missing).toEqual([]);
  });
});
