import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterConnectionsByIds } from "@/shared/utils/connectionStatus.js";

const connections = [
  { id: "one", provider: "claude", providerSpecificData: { enabledModels: ["model-a"] } },
  { id: "two", provider: "claude", providerSpecificData: { enabledModels: ["model-b"] } },
  { id: "Three", provider: "openai", isActive: false },
];

describe("model picker account scope", () => {
  it("preserves the full catalog without account restrictions", () => {
    expect(filterConnectionsByIds(connections, null)).toBe(connections);
  });
  it("keeps only selected accounts and their model entitlements", () => {
    expect(filterConnectionsByIds(connections, ["two"])).toEqual([connections[1]]);
    expect(filterConnectionsByIds(connections, ["one", "two"])).toEqual(connections.slice(0, 2));
  });
  it("treats empty, deleted and case-mismatched IDs as no available accounts", () => {
    for (const ids of [[], ["deleted"], ["three"]]) expect(filterConnectionsByIds(connections, ids)).toEqual([]);
  });
  it("scopes fetched data before live catalogs and excludes unselected public/custom providers", () => {
    const source = readFileSync(new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url), "utf8");
    expect(source).toContain("filterConnectionsByIds(fetchedConnections !== null ? fetchedConnections : (activeProviders || []), allowedConnectionIds)");
    expect(source).toContain("allowedConnectionIds === null || activeConnectionIds.includes(id)");
    expect(source).toContain("const providerConns = filteredActiveProviders.filter");
  });
});
