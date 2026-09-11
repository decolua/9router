/**
 * Unit tests for the import route's batch-ID validation logic.
 *
 * We test the pure business logic — whether selectedCanonicalIds are all
 * members of the requested discovery batch — without wiring HTTP or the DB.
 */
import { describe, expect, it } from "vitest";

// ── Replicate the batch-validation logic from import/route.js ─────────────

function validateImportSelection({ batchSnapshots, selectedCanonicalIds }) {
  const batchByCanonical = new Map(batchSnapshots.map((s) => [s.canonicalId, s]));
  const selectedSet = new Set(selectedCanonicalIds);
  const unknownIds = [...selectedSet].filter((cid) => !batchByCanonical.has(cid));

  if (unknownIds.length > 0) {
    return { ok: false, unknownIds };
  }

  const selected = [...selectedSet].map((cid) => batchByCanonical.get(cid));
  return { ok: true, selected };
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const BATCH_ID = "batch-abc-123";
const CONN_ID = "conn-xyz";

function makeSnapshot(canonicalId, overrides = {}) {
  return {
    id: `snap-${canonicalId}`,
    discoveryBatchId: BATCH_ID,
    connectionId: CONN_ID,
    providerAlias: "gcli",
    rawModelId: canonicalId.split("/")[1],
    canonicalId,
    displayName: canonicalId,
    modelKind: "llm",
    source: "upstream_api",
    confidence: "authoritative",
    ...overrides,
  };
}

const BATCH_SNAPSHOTS = [
  makeSnapshot("gcli/grok-4.6"),
  makeSnapshot("gcli/grok-4.5"),
  makeSnapshot("gcli/grok-build"),
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe("import batch-ID validation", () => {
  it("accepts canonical IDs that are all in the batch", () => {
    const result = validateImportSelection({
      batchSnapshots: BATCH_SNAPSHOTS,
      selectedCanonicalIds: ["gcli/grok-4.6", "gcli/grok-4.5"],
    });
    expect(result.ok).toBe(true);
    expect(result.selected).toHaveLength(2);
    expect(result.selected.map((s) => s.canonicalId).sort()).toEqual([
      "gcli/grok-4.5",
      "gcli/grok-4.6",
    ]);
  });

  it("accepts a single-item selection", () => {
    const result = validateImportSelection({
      batchSnapshots: BATCH_SNAPSHOTS,
      selectedCanonicalIds: ["gcli/grok-build"],
    });
    expect(result.ok).toBe(true);
    expect(result.selected).toHaveLength(1);
  });

  it("rejects any ID not present in the batch", () => {
    const result = validateImportSelection({
      batchSnapshots: BATCH_SNAPSHOTS,
      selectedCanonicalIds: ["gcli/grok-4.6", "gcli/grok-999"],
    });
    expect(result.ok).toBe(false);
    expect(result.unknownIds).toContain("gcli/grok-999");
  });

  it("rejects IDs from a different provider", () => {
    const result = validateImportSelection({
      batchSnapshots: BATCH_SNAPSHOTS,
      selectedCanonicalIds: ["kiro/gpt-5.6-sol"],
    });
    expect(result.ok).toBe(false);
    expect(result.unknownIds).toContain("kiro/gpt-5.6-sol");
  });

  it("deduplicates selectedCanonicalIds (Set semantics)", () => {
    const result = validateImportSelection({
      batchSnapshots: BATCH_SNAPSHOTS,
      selectedCanonicalIds: ["gcli/grok-4.6", "gcli/grok-4.6", "gcli/grok-4.5"],
    });
    expect(result.ok).toBe(true);
    // Deduped: only 2 unique IDs
    expect(result.selected).toHaveLength(2);
  });

  it("returns ok:true for empty batch if no IDs requested (no-op)", () => {
    const result = validateImportSelection({
      batchSnapshots: [],
      selectedCanonicalIds: [],
    });
    // No unknown IDs (empty set) — but the route itself guards against empty
    expect(result.ok).toBe(true);
    expect(result.selected).toHaveLength(0);
  });

  it("rejects all IDs when batch is empty", () => {
    const result = validateImportSelection({
      batchSnapshots: [],
      selectedCanonicalIds: ["gcli/grok-4.6"],
    });
    expect(result.ok).toBe(false);
    expect(result.unknownIds).toContain("gcli/grok-4.6");
  });
});
