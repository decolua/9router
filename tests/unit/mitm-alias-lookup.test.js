import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { findMappedOverride } = require("../../src/mitm/aliasLookup.js");

const synonyms = { antigravity: { public: "canonical" } };
const patterns = { antigravity: [{ match: /flash/i, alias: "flash" }] };

const lookup = (aliases, model, tool = "antigravity") =>
  findMappedOverride({ tool, model, aliases, synonyms, patterns });

describe("MITM structured alias lookup", () => {
  it("returns exact structured overrides", () => {
    expect(lookup({ exact: { reasoningEffort: "high" } }, "exact")).toEqual({ reasoningEffort: "high" });
  });

  it("resolves synonyms, prefixes, and patterns", () => {
    expect(lookup({ canonical: { model: "p/synonym" } }, "models/public")).toEqual({ model: "p/synonym" });
    expect(lookup({ canonical: { model: "p/synonym" } }, "public")).toEqual({ model: "p/synonym" });
    expect(lookup({ "gemini-pro": { model: "p/prefix" } }, "gemini-pro-latest")).toEqual({ model: "p/prefix" });
    expect(lookup({ flash: { model: "p/pattern" } }, "new-flash-agent")).toEqual({ model: "p/pattern" });
  });

  it("returns null for missing models or aliases", () => {
    expect(lookup(null, "model")).toBe(null);
    expect(lookup({}, null)).toBe(null);
    expect(lookup({}, "unknown")).toBe(null);
  });
});
