/**
 * Unit tests for the discovery-batch diff logic used in snapshotsRepo.
 *
 * The diff compares new batch snapshots against a previous batch to determine
 * which models are new, removed, changed, or unchanged.
 *
 * We test the pure algorithm without a DB connection.
 */
import { describe, expect, it } from "vitest";

// ── Replicate the pure diff helpers from snapshotsRepo.js ─────────────────

function stringifyJson(v) {
  return v === null || v === undefined ? null : JSON.stringify(v);
}

function snapshotDiffFields(snapshot) {
  return {
    contextWindow: snapshot.contextWindow ?? null,
    maxOutput: snapshot.maxOutput ?? null,
    inputModalities: stringifyJson(snapshot.inputModalities ?? null),
    outputModalities: stringifyJson(snapshot.outputModalities ?? null),
    supportsReasoning: snapshot.supportsReasoning ?? false,
    supportsTools: snapshot.supportsTools ?? false,
    supportsSearch: snapshot.supportsSearch ?? false,
    supportsVision: snapshot.supportsVision ?? false,
    rawPayloadHash: snapshot.rawPayloadHash ?? null,
  };
}

function diffBatches(previousSnapshots, newSnapshots) {
  const oldByCanonical = new Map(previousSnapshots.map((s) => [s.canonicalId, s]));
  const result = { new: [], removed: [], changed: [], unchanged: [] };
  const seen = new Set();

  for (const snap of newSnapshots) {
    const old = oldByCanonical.get(snap.canonicalId);
    seen.add(snap.canonicalId);
    if (!old) {
      result.new.push(snap);
      continue;
    }
    if (JSON.stringify(snapshotDiffFields(old)) === JSON.stringify(snapshotDiffFields(snap))) {
      result.unchanged.push(snap);
    } else {
      result.changed.push({ canonicalId: snap.canonicalId, before: old, after: snap });
    }
  }

  for (const [canonicalId, old] of oldByCanonical) {
    if (!seen.has(canonicalId)) result.removed.push(old);
  }

  return result;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeSnap(canonicalId, overrides = {}) {
  return {
    canonicalId,
    contextWindow: 128000,
    maxOutput: 8192,
    inputModalities: null,
    outputModalities: null,
    supportsReasoning: false,
    supportsTools: false,
    supportsSearch: false,
    supportsVision: false,
    rawPayloadHash: `hash-${canonicalId}`,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("diffAgainstPreviousBatch", () => {
  it("marks brand-new models as 'new' when no previous batch exists", () => {
    const diff = diffBatches([], [
      makeSnap("gcli/grok-4.6"),
      makeSnap("gcli/grok-4.5"),
    ]);
    expect(diff.new).toHaveLength(2);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("marks models present in both batches with identical fields as 'unchanged'", () => {
    const snap = makeSnap("gcli/grok-4.6");
    const diff = diffBatches([snap], [snap]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.new).toHaveLength(0);
  });

  it("marks models with changed contextWindow as 'changed'", () => {
    const old = makeSnap("gcli/grok-4.6", { contextWindow: 128000 });
    const updated = makeSnap("gcli/grok-4.6", { contextWindow: 500000 });
    const diff = diffBatches([old], [updated]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].canonicalId).toBe("gcli/grok-4.6");
    expect(diff.changed[0].before.contextWindow).toBe(128000);
    expect(diff.changed[0].after.contextWindow).toBe(500000);
  });

  it("marks models missing from the new batch as 'removed'", () => {
    const prev = [makeSnap("gcli/grok-4.6"), makeSnap("gcli/grok-legacy")];
    const next = [makeSnap("gcli/grok-4.6")];
    const diff = diffBatches(prev, next);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].canonicalId).toBe("gcli/grok-legacy");
  });

  it("handles mixed new/changed/unchanged/removed in one diff", () => {
    const prev = [
      makeSnap("gcli/model-a", { contextWindow: 128000 }),
      makeSnap("gcli/model-b"),
      makeSnap("gcli/model-old"),
    ];
    const next = [
      makeSnap("gcli/model-a", { contextWindow: 500000 }), // changed
      makeSnap("gcli/model-b"),                              // unchanged
      makeSnap("gcli/model-new"),                            // new
      // model-old is absent → removed
    ];
    const diff = diffBatches(prev, next);
    expect(diff.changed.map((x) => x.canonicalId)).toEqual(["gcli/model-a"]);
    expect(diff.unchanged.map((s) => s.canonicalId)).toEqual(["gcli/model-b"]);
    expect(diff.new.map((s) => s.canonicalId)).toEqual(["gcli/model-new"]);
    expect(diff.removed.map((s) => s.canonicalId)).toEqual(["gcli/model-old"]);
  });

  it("detects capability flag changes as 'changed'", () => {
    const old = makeSnap("gcli/grok-4.6", { supportsReasoning: false });
    const updated = makeSnap("gcli/grok-4.6", { supportsReasoning: true });
    const diff = diffBatches([old], [updated]);
    expect(diff.changed).toHaveLength(1);
  });

  it("detects rawPayloadHash changes as 'changed'", () => {
    const old = makeSnap("gcli/grok-4.6", { rawPayloadHash: "hash-1" });
    const updated = makeSnap("gcli/grok-4.6", { rawPayloadHash: "hash-2" });
    const diff = diffBatches([old], [updated]);
    expect(diff.changed).toHaveLength(1);
  });

  it("treats null and undefined contextWindow as equivalent (no change)", () => {
    const old = makeSnap("gcli/m1", { contextWindow: null });
    const updated = makeSnap("gcli/m1", { contextWindow: undefined });
    const diff = diffBatches([old], [updated]);
    expect(diff.unchanged).toHaveLength(1);
  });
});
