import { describe, it, expect } from "vitest";
import { filterModelsByScope } from "../../src/lib/scopeModelsFilter.js";

const CATALOG = [
  { id: "anthropic/claude-sonnet-4-5", object: "model", owned_by: "anthropic" },
  { id: "anthropic/claude-haiku-4-5", object: "model", owned_by: "anthropic" },
  { id: "openai/gpt-4", object: "model", owned_by: "openai" },
  { id: "my-combo", object: "model", owned_by: "combo" },
];

describe("scopeModelsFilter", () => {
  it("returns the list unchanged for null/undefined scope (back-compat)", () => {
    expect(filterModelsByScope(CATALOG, null)).toBe(CATALOG);
    expect(filterModelsByScope(CATALOG, undefined)).toBe(CATALOG);
  });

  it("narrows the catalog to the scoped provider's models", () => {
    const scope = { providers: ["anthropic"], models: [] };
    const filtered = filterModelsByScope(CATALOG, scope);
    expect(filtered.map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-haiku-4-5",
    ]);
  });

  it("narrows further to a specific model when models axis is set", () => {
    const scope = { providers: ["anthropic"], models: ["anthropic/claude-sonnet-4-5"] };
    const filtered = filterModelsByScope(CATALOG, scope);
    expect(filtered.map((m) => m.id)).toEqual(["anthropic/claude-sonnet-4-5"]);
  });

  it("drops combo entries (no provider prefix) under a restricted scope", () => {
    const scope = { providers: ["anthropic"] };
    const filtered = filterModelsByScope(CATALOG, scope);
    expect(filtered.find((m) => m.id === "my-combo")).toBeUndefined();
  });
});
