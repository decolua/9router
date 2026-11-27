import { describe, expect, it } from "vitest";
import { buildModelGroups, collectModelValues } from "@/shared/utils/selectableModels.js";

describe("no-auth search providers in model selection (#3269)", () => {
  it("offers SearXNG as a Web Search combo member without a connection", () => {
    const groups = buildModelGroups({ kindFilter: "webSearch", connections: [] });

    expect(groups.searxng?.models).toEqual([
      { id: "searxng", name: "SearXNG", value: "searxng" },
    ]);
    expect(collectModelValues(groups)).toContain("searxng");
  });

  it("keeps credentialed search providers gated on a connection", () => {
    const empty = buildModelGroups({ kindFilter: "webSearch", connections: [] });
    expect(empty.tavily).toBeUndefined();

    const connected = buildModelGroups({
      kindFilter: "webSearch",
      connections: [{ provider: "tavily", isActive: true }],
    });
    expect(collectModelValues(connected)).toContain("tavily");
    expect(collectModelValues(connected)).toContain("searxng");
  });

  it("respects an explicitly deactivated SearXNG connection", () => {
    const groups = buildModelGroups({
      kindFilter: "webSearch",
      connections: [],
      allConnections: [{ provider: "searxng", isActive: false }],
    });
    expect(groups.searxng).toBeUndefined();
  });

  it.each([null, "webFetch", "tts"])("does not offer SearXNG for kind %s", (kindFilter) => {
    const groups = buildModelGroups({ kindFilter, connections: [] });
    expect(groups.searxng).toBeUndefined();
  });

  it("does not duplicate SearXNG when a connection is also present", () => {
    const groups = buildModelGroups({
      kindFilter: "webSearch", connections: [{ provider: "searxng", isActive: true }],
    });
    expect(collectModelValues(groups).filter(value => value === "searxng")).toEqual(["searxng"]);
  });

  it("does not automatically offer hidden no-auth TTS providers", () => {
    const groups = buildModelGroups({ kindFilter: "tts", connections: [] });
    expect(groups.coqui).toBeUndefined();
    expect(groups.tortoise).toBeUndefined();
    expect(groups["edge-tts"]).toBeDefined();
  });
});
