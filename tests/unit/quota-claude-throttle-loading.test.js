import { describe, expect, it } from "vitest";
import {
  buildLoadingState,
  CLAUDE_REFRESH_INTERVAL_MS,
  REFRESH_INTERVAL_MS,
  selectConnectionsToRefresh,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const connections = [
  { id: "claude-1", provider: "claude" },
  { id: "codex-1", provider: "codex" },
  { id: "claude-2", provider: "claude" },
  { id: "gemini-1", provider: "gemini-cli" },
];
const claudeEvery = Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS);
const ids = (list) => list.map((connection) => connection.id);

describe("quota auto-refresh Claude throttle", () => {
  it("skips Claude on ticks that are not a multiple of the Claude interval", () => {
    for (let tick = 1; tick < claudeEvery; tick += 1) {
      expect(ids(selectConnectionsToRefresh(connections, { tick }))).toEqual(["codex-1", "gemini-1"]);
    }
  });

  it("fetches Claude on every Nth tick", () => {
    expect(ids(selectConnectionsToRefresh(connections, { tick: claudeEvery }))).toEqual(ids(connections));
    expect(ids(selectConnectionsToRefresh(connections, { tick: claudeEvery * 3 }))).toEqual(ids(connections));
  });

  it("fetches everything on a manual (forced) refresh", () => {
    expect(ids(selectConnectionsToRefresh(connections, { force: true, tick: 1 }))).toEqual(ids(connections));
  });

  it("does not mark a throttled Claude account as loading", () => {
    // refreshAll builds the loading state from the same list it fetches; a skipped
    // account left as loading would never be cleared and would spin until its next fetch
    const loading = buildLoadingState(selectConnectionsToRefresh(connections, { tick: 1 }));
    expect(loading["claude-1"]).toBeUndefined();
    expect(loading["claude-2"]).toBeUndefined();
    expect(loading["codex-1"]).toBe(true);
    expect(loading["gemini-1"]).toBe(true);
  });
});
