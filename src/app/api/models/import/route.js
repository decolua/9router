import { NextResponse } from "next/server";
import * as snapshotsRepo from "@/lib/db/repos/snapshotsRepo";
import { getAdapter } from "@/lib/db/driver";

export const dynamic = "force-dynamic";

/**
 * POST /api/models/import
 * Body: { snapshotId, selectedCanonicalIds, dryRun? }
 *
 * `snapshotId` must be a valid snapshot row id. The import is restricted to
 * snapshots sharing the same discoveryBatchId as the seed snapshot — IDs from
 * other batches are rejected, preventing stale or cross-session imports.
 *
 * All custom-model writes happen inside a single DB transaction.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { snapshotId, selectedCanonicalIds, dryRun = false } = body;

    if (!snapshotId) {
      return NextResponse.json({ error: "snapshotId is required" }, { status: 400 });
    }
    if (!Array.isArray(selectedCanonicalIds) || selectedCanonicalIds.length === 0) {
      return NextResponse.json({ error: "selectedCanonicalIds must be a non-empty array" }, { status: 400 });
    }

    // Resolve the seed snapshot to get its batch.
    const seedSnapshot = await snapshotsRepo.getSnapshotById(snapshotId);
    if (!seedSnapshot) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }

    const { connectionId, discoveryBatchId, providerAlias } = seedSnapshot;

    // Fetch only snapshots from the same discovery batch — strict validation.
    const batchSnapshots = await snapshotsRepo.getSnapshotsByBatch(discoveryBatchId);
    const batchByCanonical = new Map(batchSnapshots.map((s) => [s.canonicalId, s]));

    const selectedSet = new Set(selectedCanonicalIds);

    // Reject any canonical IDs not present in the batch.
    const unknownIds = [...selectedSet].filter((cid) => !batchByCanonical.has(cid));
    if (unknownIds.length > 0) {
      return NextResponse.json(
        {
          error: "Some selectedCanonicalIds are not in the discovery batch",
          unknownIds,
          batchId: discoveryBatchId,
        },
        { status: 422 }
      );
    }

    const selected = [...selectedSet].map((cid) => batchByCanonical.get(cid));

    const records = selected.map((s) => ({
      canonicalId: s.canonicalId,
      providerAlias: s.providerAlias,
      id: s.rawModelId,
      type: s.modelKind === "unknown" ? "llm" : s.modelKind,
      name: s.displayName,
    }));

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        willWrite: records.length,
        batchId: discoveryBatchId,
        records: records.map((r) => ({
          canonicalId: r.canonicalId,
          providerAlias: r.providerAlias,
          id: r.id,
          type: r.type,
          name: r.name,
        })),
      });
    }

    // Transactional batch import — all custom-model writes in one transaction.
    // We replicate the kv-insert logic from addCustomModel to avoid nested
    // transactions (addCustomModel wraps each insert in its own transaction).
    const db = await getAdapter();
    const { stringifyJson } = await import("@/lib/db/helpers/jsonCol");
    const results = [];
    db.transaction(() => {
      for (const r of records) {
        const scope = "customModels";
        const key = `${r.providerAlias}|${r.id}|${r.type}`;
        const existing = db.get(`SELECT 1 FROM kv WHERE scope = ? AND key = ?`, [scope, key]);
        if (existing) {
          results.push({ canonicalId: r.canonicalId, written: false });
          continue;
        }
        const value = stringifyJson({ providerAlias: r.providerAlias, id: r.id, type: r.type, name: r.name || r.id });
        db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)`, [scope, key, value]);
        results.push({ canonicalId: r.canonicalId, written: true });
      }
    });

    const writtenCount = results.filter((r) => r.written).length;
    const skippedCount = results.length - writtenCount;

    const session = await snapshotsRepo.createImportSession({
      connectionId,
      discoveryBatchId,
      providerAlias,
      totalCount: batchSnapshots.length,
      selectedCount: selected.length,
    });
    await snapshotsRepo.commitImportSession(session.id);

    return NextResponse.json({
      importSessionId: session.id,
      status: "committed",
      batchId: discoveryBatchId,
      written: writtenCount,
      skipped: skippedCount,
      records: results,
    });
  } catch (error) {
    console.warn("Error in import endpoint:", error);
    return NextResponse.json({ error: "Failed to import models" }, { status: 500 });
  }
}

/**
 * GET /api/models/import?id=xxx
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const session = await snapshotsRepo.getImportSession(id);
    if (!session) {
      return NextResponse.json({ error: "Import session not found" }, { status: 404 });
    }

    return NextResponse.json(session);
  } catch (error) {
    console.warn("Error fetching import session:", error);
    return NextResponse.json({ error: "Failed to fetch import session" }, { status: 500 });
  }
}
