import { describe, expect, it } from "vitest";
import { buildPriorityUpdates } from "../../src/app/(dashboard)/dashboard/providers/utils.js";

// Simulates the server-side invariant enforced by connectionsRepo:
// rows are ordered by priority ASC, ties broken by most-recently-updated,
// then renumbered 1..N. Called after every persisted write.
function flush(rows) {
  const sorted = [...rows].sort((a, b) => {
    const diff = (a.priority || 0) - (b.priority || 0);
    if (diff !== 0) return diff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  sorted.forEach((row, i) => {
    row.priority = i + 1;
  });
  return sorted;
}

function makeConnections(priorities) {
  return priorities.map((priority, i) => ({
    id: `c${i}`,
    priority,
    updatedAt: new Date(2026, 0, i + 1).toISOString(),
  }));
}

// Order of rows as the server would serve them back (priority ASC).
function orderedIds(rows) {
  return [...rows]
    .sort((a, b) => a.priority - b.priority)
    .map((row) => row.id);
}

// The fixed client: writes applied one at a time, server flushes after each.
// Each PUT reaches the server in its own HTTP round trip, so the server's
// updatedAt clock strictly increases between writes — modeled with a
// monotonic counter (Date.now() in a tight loop would collide at the same
// millisecond, which cannot happen across sequential HTTP requests).
let writeClock = 0;
function applySequential(rows, updates) {
  const db = rows.map((row) => ({ ...row }));
  for (const update of updates) {
    const row = db.find((entry) => entry.id === update.id);
    row.priority = update.priority;
    writeClock += 1;
    row.updatedAt = new Date(2026, 5, 1, 0, 0, 0, writeClock).toISOString();
    flush(db);
  }
  return db;
}

// The old client: Promise.all — all writes land before the last flush.
function applyParallel(rows, updates) {
  const db = rows.map((row) => ({ ...row }));
  for (const update of updates) {
    const row = db.find((entry) => entry.id === update.id);
    row.priority = update.priority;
    row.updatedAt = new Date().toISOString();
  }
  flush(db);
  return db;
}

// Every single move of `current` must converge to its requested order.
function expectEverySingleMoveConverges(current) {
  const n = current.length;
  for (let from = 0; from < n; from += 1) {
    for (let to = 0; to < n; to += 1) {
      if (from === to) continue;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);

      const rows = applySequential(current, buildPriorityUpdates(next));
      expect(orderedIds(rows)).toEqual(next.map((c) => c.id));
    }
  }
}

describe("buildPriorityUpdates", () => {
  it("writes every row's final 1-based position", () => {
    const current = makeConnections([1, 2, 3, 4, 5]);
    const next = [...current];
    [next[1], next[2]] = [next[2], next[1]];

    const updates = buildPriorityUpdates(next);

    expect(updates).toEqual([
      { id: "c0", priority: 1 },
      { id: "c2", priority: 2 },
      { id: "c1", priority: 3 },
      { id: "c3", priority: 4 },
      { id: "c4", priority: 5 },
    ]);
  });

  it("returns an empty set when the order is already final", () => {
    const current = makeConnections([1, 2, 3]);
    expect(buildPriorityUpdates([...current])).toEqual([]);
  });

  it("lands every possible single move (all from→to pairs, sizes 2–8, pristine priorities)", () => {
    // The UI exposes only single moves (up/down arrows). With sequential
    // ascending writes, every one of them must land exactly.
    for (let n = 2; n <= 8; n += 1) {
      expectEverySingleMoveConverges(makeConnections(Array.from({ length: n }, (_, k) => k + 1)));
    }
  });

  it("lands every single move when stored priorities contain duplicates", () => {
    // Bulk import can leave tied priorities (POST defaults to 1). The server
    // re-breaks ties by most-recently-updated on every PUT, so skipped rows
    // would drift — every row must be written. This case diverged 440/572
    // under the previous changed-rows-only strategy.
    const shapes = [
      [1, 3, 1],
      [1, 3, 1, 3, 1],
      [2, 2, 2, 2],
      [2, 2, 2, 5],
      [7, 7, 1, 1, 4, 4],
    ];
    for (const shape of shapes) {
      expectEverySingleMoveConverges(makeConnections(shape));
    }
  });

  it("converges from the [1,3,1] middle→last case that diverged under changed-rows-only writes", () => {
    // Minimal regression case from review: writes that skipped tied rows let
    // the server's updatedAt tiebreak reorder them behind the client's back.
    const current = makeConnections([1, 3, 1]);
    const next = [...current];
    const [moved] = next.splice(1, 1);
    next.splice(2, 0, moved);

    const rows = applySequential(current, buildPriorityUpdates(next));
    expect(orderedIds(rows)).toEqual(["c0", "c2", "c1"]);
  });

  it("lands consecutive rapid moves (each applied against the previous result)", () => {
    let rows = makeConnections([1, 2, 3, 4, 5]);

    // Move last row up twice in a row — like a user clicking quickly.
    for (const [from, to] of [[4, 3], [3, 2]]) {
      const current = [...rows].sort((a, b) => a.priority - b.priority);
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      rows = applySequential(current, buildPriorityUpdates(next));
      expect(orderedIds(rows)).toEqual(next.map((c) => c.id));
    }
    expect(orderedIds(rows)).toEqual(["c0", "c1", "c4", "c2", "c3"]);
  });

  it("fixes the raw-index collision bug (#329) where parallel legacy writes promoted the row to the top", () => {
    const current = makeConnections([1, 2, 3, 4, 5]);

    // Old client behavior: raw 0-based indices for the swapped pair, in
    // parallel. The server renumber promoted c2 all the way to the top.
    const legacyRows = applyParallel(current, [
      { id: "c2", priority: 1 },
      { id: "c1", priority: 2 },
    ]);
    expect(orderedIds(legacyRows)).toEqual(["c2", "c0", "c1", "c3", "c4"]);

    // Fixed behavior reaches the requested one-position move instead.
    const next = [...current];
    [next[1], next[2]] = [next[2], next[1]];
    const rows = applySequential(current, buildPriorityUpdates(next));
    expect(orderedIds(rows)).toEqual(["c0", "c2", "c1", "c3", "c4"]);
  });
});
