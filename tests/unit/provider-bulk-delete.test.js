import { describe, expect, it } from "vitest";
import {
  deleteProviderConnections,
  getConnectionSelectionState,
  removeConnectionsById,
} from "../../src/app/(dashboard)/dashboard/providers/[id]/bulkConnectionActions.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("provider bulk connection actions", () => {
  it("keeps selection limited to current connections", () => {
    const connections = [
      { id: "conn-1", name: "One" },
      { id: "conn-2", name: "Two" },
    ];

    expect(getConnectionSelectionState(connections, [
      "conn-1",
      "missing",
      "conn-2",
    ])).toEqual({
      selectedConnections: connections,
      selectedIds: ["conn-1", "conn-2"],
      selectedCount: 2,
      allSelected: true,
      hasSelection: true,
    });
  });

  it("deletes unique connection ids with a concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const calls = [];
    const fetchFn = async (url, options) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push({ url, method: options.method });
      await delay(5);
      active -= 1;
      return {
        ok: !url.endsWith("/conn-fail"),
        status: url.endsWith("/conn-fail") ? 500 : 200,
      };
    };

    const result = await deleteProviderConnections(
      ["conn-1", "conn-2", "conn-fail", "conn-1"],
      { fetchFn, concurrency: 2 },
    );

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(calls.map((call) => call.method)).toEqual([
      "DELETE",
      "DELETE",
      "DELETE",
    ]);
    expect(calls.map((call) => call.url).sort()).toEqual([
      "/api/providers/conn-1",
      "/api/providers/conn-2",
      "/api/providers/conn-fail",
    ]);
    expect(result.deletedIds).toEqual(["conn-1", "conn-2"]);
    expect(result.failed).toEqual([{ id: "conn-fail", status: 500 }]);
  });

  it("removes only successfully deleted connections from the list", () => {
    expect(removeConnectionsById(
      [
        { id: "conn-1" },
        { id: "conn-2" },
        { id: "conn-3" },
      ],
      ["conn-1", "conn-3"],
    )).toEqual([{ id: "conn-2" }]);
  });
});
