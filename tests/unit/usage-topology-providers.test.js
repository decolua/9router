import { describe, expect, it } from "vitest";
import { addUsedFreeProviders } from "../../src/shared/components/usageTopologyProviders.js";

const catalog = {
  opencode: { id: "opencode", name: "OpenCode Free", noAuth: true },
  hidden: { id: "hidden", name: "Hidden", noAuth: true, hidden: true },
  search: { id: "search", name: "Search", noAuth: true },
};
const llm = (id) => id !== "search";

describe("usage topology free providers", () => {
  it("excludes unused providers but includes providers with usage in the selected period", () => {
    const connected = [{ provider: "codex", name: "Codex" }];
    expect(addUsedFreeProviders(connected, catalog, {}, llm)).toEqual(connected);
    expect(addUsedFreeProviders(connected, catalog, { opencode: { requests: 2 } }, llm))
      .toEqual([...connected, { provider: "opencode", name: "OpenCode Free" }]);
  });

  it("avoids duplicate, hidden and non-LLM nodes", () => {
    const connected = [{ provider: "opencode", name: "Connected" }];
    expect(addUsedFreeProviders(connected, catalog, {
      opencode: { requests: 1 }, hidden: { requests: 1 }, search: { requests: 1 },
    }, llm)).toEqual(connected);
  });
});
