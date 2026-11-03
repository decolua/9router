import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import { getComboModelValue } from "@/shared/utils/comboModels.js";

/**
 * ComboFormModal.js is JSX living in a .js file and the Vitest/Vite setup has no
 * JSX transform for it, so it cannot be imported directly. The established
 * repository pattern (see kenari-deepseek-vision-zed-modal.test.js and
 * mobile-drawer.test.js) is to verify behaviour through the pure helper modules
 * the component depends on, plus a scoped source-contract scan of the component.
 *
 * removeComboModels is a batch-removal helper whose single line is:
 *   models.filter((entry) => !values.has(getComboModelValue(entry)))
 * getComboModelValue is the pure primitive that decides which value each entry
 * is keyed by, so the removal contract is exercised below through that same
 * helper without loading JSX.
 *
 * The Oracle gap this file closes: the old scan proved removeComboModels existed
 * but never proved the component's onDeselectBatch callback actually delegates to
 * it (a caller could inline a different filter). The assertions below are scoped
 * to the onDeselectBatch callback block and key on argument structure, not on
 * whitespace, quote style or comment text.
 */
const removeComboModels = (models, values) =>
  models.filter((entry) => !values.has(getComboModelValue(entry)));

// Brace-balanced block extraction so assertions bind to the real callback body.
function extractBraceBlock(src, anchorRegex) {
  const anchor = anchorRegex.exec(src);
  if (!anchor) return null;
  const start = src.indexOf("{", anchor.index + anchor[0].length - 1);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("removeComboModels", () => {
  it("removes an account-pinned model selected in a batch while retaining untouched entry identity", () => {
    const pinned = { model: "provider/remove-me", connectionId: "account-1" };
    const retained = { model: "provider/keep-me", connectionId: "account-2" };
    const models = [pinned, retained, "provider/also-keep"];

    const remaining = removeComboModels(models, new Set(["provider/remove-me"]));

    expect(remaining).toEqual([retained, "provider/also-keep"]);
    expect(remaining[0]).toBe(retained);
  });

  it("keys account-pinned entries by their model value, ignoring connectionId", () => {
    const pinned = { model: "provider/remove-me", connectionId: "account-1" };
    const sameModelOtherAccount = { model: "provider/remove-me", connectionId: "account-9" };
    const models = [pinned, sameModelOtherAccount, "provider/keep-me"];

    const remaining = removeComboModels(models, new Set(["provider/remove-me"]));

    expect(remaining).toEqual(["provider/keep-me"]);
  });

  it("removes plain string entries selected in a batch", () => {
    const models = ["provider/a", "provider/b", "provider/c"];
    const remaining = removeComboModels(models, new Set(["provider/a", "provider/c"]));
    expect(remaining).toEqual(["provider/b"]);
  });

  it("returns the same array elements (not copies) when nothing is selected", () => {
    const kept = { model: "provider/keep-me", connectionId: "account-2" };
    const models = [kept, "provider/also-keep"];
    const remaining = removeComboModels(models, new Set());
    expect(remaining).toEqual(models);
    expect(remaining[0]).toBe(kept);
  });

  it("treats malformed entries safely by keying them as empty strings", () => {
    const models = [null, 42, { notModel: true }, "provider/keep-me"];
    const remaining = removeComboModels(models, new Set([""]));
    expect(remaining).toEqual(["provider/keep-me"]);
  });
});

describe("ComboFormModal source contract", () => {
  let src;
  let code;
  beforeAll(() => {
    const fileUrl = new URL("../../src/shared/components/ComboFormModal.js", import.meta.url);
    src = fs.readFileSync(fileUrl, "utf-8");
    code = stripComments(src);
  });

  it("defines removeComboModels filtering by !values.has(getComboModelValue(entry))", () => {
    const fnBlock = extractBraceBlock(code, /export\s+function\s+removeComboModels\s*\(/);
    expect(fnBlock).not.toBeNull();
    expect(fnBlock).toMatch(/models\.filter\(\s*\(\s*entry\s*\)\s*=>\s*!values\.has\(\s*getComboModelValue\(\s*entry\s*\)\s*\)\s*\)/);
  });

  it("imports getComboModelValue from the shared comboModels util", () => {
    expect(code).toMatch(/import\s*\{[^}]*\bgetComboModelValue\b[^}]*\}\s*from\s*["']@\/shared\/utils\/comboModels["']/);
  });

  it("normalizes onDeselectBatch items to their value before delegating", () => {
    // Scoped to the onDeselectBatch callback: proves the component maps each
    // entry (object or string) down to a primitive value and drops falsy ones,
    // so removeComboModels receives comparable keys regardless of shape.
    const block = extractBraceBlock(code, /onDeselectBatch\s*=\s*\{\s*\(/);
    expect(block).not.toBeNull();
    expect(block).toMatch(/\.map\(\s*\(\s*m\s*\)\s*=>\s*m\?\.value\s*\|\|\s*m\?\.name\s*\|\|\s*m\s*\)/);
    expect(block).toMatch(/\.filter\(\s*Boolean\s*\)/);
    expect(block).toMatch(/new Set\(/);
  });

  it("delegates functional previous state to removeComboModels(prev, vals)", () => {
    // The critical ordering contract: removeComboModels must receive the updater's
    // previous models FIRST and the normalized Set SECOND. Swapping the args or
    // replacing the functional updater with a stale `models` closure both fail here.
    const block = extractBraceBlock(code, /onDeselectBatch\s*=\s*\{\s*\(/);
    expect(block).not.toBeNull();
    expect(block).toMatch(/setModels\(\s*\(\s*prev\s*\)\s*=>/);
    expect(block).toMatch(/removeComboModels\(\s*prev\s*,\s*vals\s*\)/);
  });

  it("keeps onSelectBatch as a non-destructive de-duplicating union", () => {
    const block = extractBraceBlock(code, /onSelectBatch\s*=\s*\{\s*\(/);
    expect(block).not.toBeNull();
    expect(block).toMatch(/setModels\(\s*\(\s*prev\s*\)\s*=>/);
    expect(block).toMatch(/new Set\(\s*\[\s*\.\.\.prev\s*,\s*\.\.\.vals\s*\]\s*\)/);
    // add path must normalize the same way as the remove path
    expect(block).toMatch(/\.map\(\s*\(\s*m\s*\)\s*=>\s*m\?\.value\s*\|\|\s*m\?\.name\s*\|\|\s*m\s*\)/);
    expect(block).toMatch(/\.filter\(\s*Boolean\s*\)/);
  });

  it("passes getComboModelValue-derived addedModelValues into the picker", () => {
    // Binds the picker's selected-state keying to the same primitive removeComboModels
    // uses, so "added" highlight and batch-remove agree on identity.
    expect(code).toMatch(/addedModelValues\s*=\s*\{\s*models\.map\(\s*getComboModelValue\s*\)\s*\}/);
  });
});
