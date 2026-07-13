import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  normalizeAliasEntry,
  normalizeAliasMappings,
  hasInvalidReasoningEffort,
  validateAliasMappings,
} = require("../../src/mitm/aliasConfig.js");

describe("Antigravity MITM alias configuration", () => {
  it("exposes the accepted explicit reasoning efforts", () => {
    expect(REASONING_EFFORTS).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("normalizes reasoning effort values case-insensitively and trims whitespace", () => {
    expect(normalizeReasoningEffort(" HIGH ")).toBe("high");
    expect(normalizeReasoningEffort("XHigh")).toBe("xhigh");
    expect(normalizeReasoningEffort("extreme")).toBe(null);
    expect(normalizeReasoningEffort("")).toBe(null);
    expect(normalizeReasoningEffort(null)).toBe(null);
  });

  it("normalizes legacy string mappings without a migration", () => {
    expect(normalizeAliasMappings({ flash: " cx/gpt-5.6-sol " })).toEqual({
      flash: { model: "cx/gpt-5.6-sol" },
    });
  });

  it("keeps a reasoning-only override and canonicalizes its value", () => {
    expect(normalizeAliasMappings({ flash: { reasoningEffort: " HIGH " } })).toEqual({
      flash: { reasoningEffort: "high" },
    });
  });

  it("keeps combined model and reasoning overrides", () => {
    expect(
      normalizeAliasMappings({
        flash: { model: "  p/m  ", reasoningEffort: "Max" },
      })
    ).toEqual({
      flash: { model: "p/m", reasoningEffort: "max" },
    });
  });

  it("drops empty legacy strings and empty structured entries", () => {
    expect(
      normalizeAliasMappings({
        a: "   ",
        b: {},
        c: { model: "", reasoningEffort: "" },
        d: { model: "keep" },
      })
    ).toEqual({
      d: { model: "keep" },
    });
  });

  it("does not mutate the caller-owned mappings object", () => {
    const input = { flash: { model: " p/m ", reasoningEffort: " HIGH " } };
    const snapshot = structuredClone(input);
    normalizeAliasMappings(input);
    expect(input).toEqual(snapshot);
  });

  it("detects unsupported reasoning effort values", () => {
    expect(hasInvalidReasoningEffort({ flash: { model: "p/m", reasoningEffort: "extreme" } })).toBe(true);
    expect(hasInvalidReasoningEffort({ flash: { model: "p/m", reasoningEffort: "xhigh" } })).toBe(false);
  });

  it("strictly rejects invalid mapping shapes for API writes", () => {
    expect(validateAliasMappings(["nope"])).toMatchObject({ ok: false });
    expect(validateAliasMappings({ flash: ["p/m"] })).toMatchObject({ ok: false });
    expect(validateAliasMappings({ flash: 12 })).toMatchObject({ ok: false });
    expect(validateAliasMappings({ flash: { model: 1 } })).toMatchObject({ ok: false });
    expect(validateAliasMappings({ flash: { reasoningEffort: 1 } })).toMatchObject({ ok: false });
    expect(validateAliasMappings({ flash: { model: "p/m", extra: true } })).toMatchObject({ ok: false });
    expect(validateAliasMappings({ flash: { model: "p/m", reasoningEffort: "extreme" } })).toMatchObject({
      ok: false,
    });
  });

  it("strictly accepts valid legacy and structured mappings", () => {
    expect(validateAliasMappings({ flash: " p/m " })).toEqual({
      ok: true,
      mappings: { flash: { model: "p/m" } },
    });
    expect(validateAliasMappings({ flash: { model: "p/m", reasoningEffort: " High " } })).toEqual({
      ok: true,
      mappings: { flash: { model: "p/m", reasoningEffort: "high" } },
    });
    expect(validateAliasMappings({ flash: { reasoningEffort: "none" } })).toEqual({
      ok: true,
      mappings: { flash: { reasoningEffort: "none" } },
    });
    expect(validateAliasMappings({ flash: { model: "  ", reasoningEffort: "" } })).toEqual({
      ok: true,
      mappings: {},
    });
  });
});

describe("normalizeAliasEntry", () => {
  it("returns null for empty or invalid entries during lossy reads", () => {
    expect(normalizeAliasEntry("")).toBe(null);
    expect(normalizeAliasEntry([])).toBe(null);
    expect(normalizeAliasEntry(null)).toBe(null);
    expect(normalizeAliasEntry({ model: "", reasoningEffort: "bogus" })).toBe(null);
  });
});
