import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// ─── modelSnapshots ──────────────────────────────────────────────────────
// Stored in the real modelSnapshots table (created by migration 002), not in
// kv: rows carry extra indexed columns plus a UNIQUE(connectionId,
// discoveryBatchId, canonicalId) constraint that the kv store cannot express.

function rowToSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    discoveryBatchId: row.discoveryBatchId,
    providerAlias: row.providerAlias,
    connectionId: row.connectionId,
    rawModelId: row.rawModelId,
    canonicalId: row.canonicalId,
    displayName: row.displayName,
    modelKind: row.modelKind,
    source: row.source,
    confidence: row.confidence,
    contextWindow: row.contextWindow,
    maxOutput: row.maxOutput,
    inputModalities: parseJson(row.inputModalities),
    outputModalities: parseJson(row.outputModalities),
    supportsReasoning: row.supportsReasoning === 1,
    supportsTools: row.supportsTools === 1,
    supportsSearch: row.supportsSearch === 1,
    supportsVision: row.supportsVision === 1,
    rawPayload: parseJson(row.rawPayload),
    rawPayloadHash: row.rawPayloadHash,
    fetchedAt: row.fetchedAt,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt,
    status: row.status,
  };
}

export async function saveSnapshot(snapshot) {
  const db = await getAdapter();
  const rec = {
    id: snapshot.id || uuidv4(),
    discoveryBatchId: snapshot.discoveryBatchId || uuidv4(),
    providerAlias: snapshot.providerAlias,
    connectionId: snapshot.connectionId,
    rawModelId: snapshot.rawModelId,
    canonicalId: snapshot.canonicalId,
    displayName: snapshot.displayName ?? null,
    modelKind: snapshot.modelKind || "unknown",
    source: snapshot.source || "upstream_api",
    confidence: snapshot.confidence || "low",
    contextWindow: snapshot.contextWindow ?? null,
    maxOutput: snapshot.maxOutput ?? null,
    inputModalities: stringifyJson(snapshot.inputModalities),
    outputModalities: stringifyJson(snapshot.outputModalities),
    supportsReasoning: snapshot.supportsReasoning ? 1 : 0,
    supportsTools: snapshot.supportsTools ? 1 : 0,
    supportsSearch: snapshot.supportsSearch ? 1 : 0,
    supportsVision: snapshot.supportsVision ? 1 : 0,
    rawPayload: stringifyJson(snapshot.rawPayload),
    rawPayloadHash: snapshot.rawPayloadHash ?? null,
    fetchedAt: snapshot.fetchedAt || new Date().toISOString(),
    observedAt: snapshot.observedAt || snapshot.fetchedAt || new Date().toISOString(),
    expiresAt: snapshot.expiresAt ?? null,
    status: snapshot.status || "active",
  };
  try {
    db.run(
      `INSERT OR REPLACE INTO modelSnapshots(
        id, discoveryBatchId, providerAlias, connectionId, rawModelId, canonicalId, displayName,
        modelKind, source, confidence, contextWindow, maxOutput,
        inputModalities, outputModalities, supportsReasoning, supportsTools, supportsSearch, supportsVision,
        rawPayload, rawPayloadHash, fetchedAt, observedAt, expiresAt, status
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rec.id, rec.discoveryBatchId, rec.providerAlias, rec.connectionId, rec.rawModelId, rec.canonicalId, rec.displayName,
        rec.modelKind, rec.source, rec.confidence, rec.contextWindow, rec.maxOutput,
        rec.inputModalities, rec.outputModalities, rec.supportsReasoning, rec.supportsTools, rec.supportsSearch, rec.supportsVision,
        rec.rawPayload, rec.rawPayloadHash, rec.fetchedAt, rec.observedAt, rec.expiresAt, rec.status,
      ]
    );
    return { saved: true };
  } catch (err) {
    console.warn(`[snapshotsRepo] saveSnapshot failed: ${err.message}`);
    return { saved: false };
  }
}

// Batch-save all snapshots sharing the same discoveryBatchId in one transaction.
// Returns count of rows written.
export async function saveSnapshotBatch(snapshots) {
  if (!snapshots.length) return 0;
  const db = await getAdapter();
  let count = 0;
  db.transaction(() => {
    for (const snapshot of snapshots) {
      const rec = {
        id: snapshot.id || uuidv4(),
        discoveryBatchId: snapshot.discoveryBatchId,
        providerAlias: snapshot.providerAlias,
        connectionId: snapshot.connectionId,
        rawModelId: snapshot.rawModelId,
        canonicalId: snapshot.canonicalId,
        displayName: snapshot.displayName ?? null,
        modelKind: snapshot.modelKind || "unknown",
        source: snapshot.source || "upstream_api",
        confidence: snapshot.confidence || "low",
        contextWindow: snapshot.contextWindow ?? null,
        maxOutput: snapshot.maxOutput ?? null,
        inputModalities: stringifyJson(snapshot.inputModalities),
        outputModalities: stringifyJson(snapshot.outputModalities),
        supportsReasoning: snapshot.supportsReasoning ? 1 : 0,
        supportsTools: snapshot.supportsTools ? 1 : 0,
        supportsSearch: snapshot.supportsSearch ? 1 : 0,
        supportsVision: snapshot.supportsVision ? 1 : 0,
        rawPayload: stringifyJson(snapshot.rawPayload),
        rawPayloadHash: snapshot.rawPayloadHash ?? null,
        fetchedAt: snapshot.fetchedAt,
        observedAt: snapshot.observedAt || snapshot.fetchedAt,
        expiresAt: snapshot.expiresAt ?? null,
        status: snapshot.status || "active",
      };
      db.run(
        `INSERT OR REPLACE INTO modelSnapshots(
          id, discoveryBatchId, providerAlias, connectionId, rawModelId, canonicalId, displayName,
          modelKind, source, confidence, contextWindow, maxOutput,
          inputModalities, outputModalities, supportsReasoning, supportsTools, supportsSearch, supportsVision,
          rawPayload, rawPayloadHash, fetchedAt, observedAt, expiresAt, status
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rec.id, rec.discoveryBatchId, rec.providerAlias, rec.connectionId, rec.rawModelId, rec.canonicalId, rec.displayName,
          rec.modelKind, rec.source, rec.confidence, rec.contextWindow, rec.maxOutput,
          rec.inputModalities, rec.outputModalities, rec.supportsReasoning, rec.supportsTools, rec.supportsSearch, rec.supportsVision,
          rec.rawPayload, rec.rawPayloadHash, rec.fetchedAt, rec.observedAt, rec.expiresAt, rec.status,
        ]
      );
      count++;
    }
  });
  return count;
}

export async function getSnapshotsByConnection(connectionId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM modelSnapshots WHERE connectionId = ? ORDER BY fetchedAt DESC`, [connectionId]);
  return rows.map(rowToSnapshot);
}

// Return all snapshots from the latest discoveryBatchId for a connection.
export async function getLatestBatchSnapshots(connectionId) {
  const db = await getAdapter();
  const batchRow = db.get(
    `SELECT discoveryBatchId FROM modelSnapshots WHERE connectionId = ? ORDER BY fetchedAt DESC LIMIT 1`,
    [connectionId]
  );
  if (!batchRow) return [];
  const rows = db.all(
    `SELECT * FROM modelSnapshots WHERE connectionId = ? AND discoveryBatchId = ?`,
    [connectionId, batchRow.discoveryBatchId]
  );
  return rows.map(rowToSnapshot);
}

// Return all snapshots belonging to a specific discoveryBatchId.
export async function getSnapshotsByBatch(discoveryBatchId) {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM modelSnapshots WHERE discoveryBatchId = ? ORDER BY canonicalId`,
    [discoveryBatchId]
  );
  return rows.map(rowToSnapshot);
}

export async function getSnapshotById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM modelSnapshots WHERE id = ?`, [id]);
  return rowToSnapshot(row);
}

// Most recent snapshot for a connection (optionally excluding a specific
// discoveryBatchId, e.g. the one just saved, to find the true "previous" one).
export async function getPreviousSnapshot(connectionId, excludeBatchId = null) {
  const db = await getAdapter();
  const row = excludeBatchId
    ? db.get(
        `SELECT * FROM modelSnapshots WHERE connectionId = ? AND discoveryBatchId != ? ORDER BY fetchedAt DESC LIMIT 1`,
        [connectionId, excludeBatchId]
      )
    : db.get(`SELECT * FROM modelSnapshots WHERE connectionId = ? ORDER BY fetchedAt DESC LIMIT 1`, [connectionId]);
  return rowToSnapshot(row);
}

// Return the discoveryBatchId of the previous (not current) batch for a connection.
export async function getPreviousBatchId(connectionId, excludeBatchId) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT discoveryBatchId FROM modelSnapshots WHERE connectionId = ? AND discoveryBatchId != ? ORDER BY fetchedAt DESC LIMIT 1`,
    [connectionId, excludeBatchId]
  );
  return row ? row.discoveryBatchId : null;
}

// Return all snapshots from the previous discoveryBatch (excluding the new one).
export async function getPreviousBatchSnapshots(connectionId, excludeBatchId) {
  const db = await getAdapter();
  const batchRow = db.get(
    `SELECT discoveryBatchId FROM modelSnapshots WHERE connectionId = ? AND discoveryBatchId != ? ORDER BY fetchedAt DESC LIMIT 1`,
    [connectionId, excludeBatchId]
  );
  if (!batchRow) return [];
  const rows = db.all(
    `SELECT * FROM modelSnapshots WHERE connectionId = ? AND discoveryBatchId = ?`,
    [connectionId, batchRow.discoveryBatchId]
  );
  return rows.map(rowToSnapshot);
}

// Fields that determine whether a snapshot "changed" between batches.
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

// Diff newSnapshots against the previous batch in the DB (not the current batch).
// excludeBatchId must be the discoveryBatchId of the newly-saved batch.
export async function diffAgainstPreviousBatch(connectionId, newSnapshots, excludeBatchId) {
  const previousRows = await getPreviousBatchSnapshots(connectionId, excludeBatchId);
  const oldByCanonical = new Map();
  for (const r of previousRows) oldByCanonical.set(r.canonicalId, r);

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

// Legacy diff — kept for backwards compat. Prefer diffAgainstPreviousBatch.
export async function diffSnapshots(connectionId, newSnapshots) {
  const db = await getAdapter();
  const oldRows = db.all(`SELECT * FROM modelSnapshots WHERE connectionId = ?`, [connectionId]);
  const oldByCanonical = new Map();
  for (const r of oldRows) oldByCanonical.set(r.canonicalId, rowToSnapshot(r));

  const result = { new: [], removed: [], changed: [], unchanged: [] };
  const seen = new Set();

  for (const snap of newSnapshots) {
    const old = oldByCanonical.get(snap.canonicalId);
    if (!old) {
      result.new.push(snap);
      continue;
    }
    seen.add(snap.canonicalId);
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

export async function deleteSnapshotsByConnection(connectionId) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM modelSnapshots WHERE connectionId = ?`, [connectionId]);
  return (res?.changes ?? 0) > 0;
}

export async function markSnapshotsStale(connectionId, excludeIds) {
  const db = await getAdapter();
  const ids = excludeIds || [];
  if (!ids.length) {
    const res = db.run(`UPDATE modelSnapshots SET status = 'stale' WHERE connectionId = ?`, [connectionId]);
    return res?.changes ?? 0;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const res = db.run(
    `UPDATE modelSnapshots SET status = 'stale' WHERE connectionId = ? AND id NOT IN (${placeholders})`,
    [connectionId, ...ids]
  );
  return res?.changes ?? 0;
}

// ─── importSessions ──────────────────────────────────────────────────────
// Real importSessions table (migration 002). Direct SQL — kv cannot express
// the preview → committed/rolled_back status transitions used here.

function rowToImportSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connectionId,
    discoveryBatchId: row.discoveryBatchId,
    providerAlias: row.providerAlias,
    totalCount: row.totalCount,
    selectedCount: row.selectedCount,
    status: row.status,
    createdAt: row.createdAt,
    committedAt: row.committedAt,
    rollbackAt: row.rollbackAt,
  };
}

export async function createImportSession({ connectionId, discoveryBatchId, providerAlias, totalCount, selectedCount }) {
  const db = await getAdapter();
  const session = {
    id: uuidv4(),
    connectionId,
    discoveryBatchId: discoveryBatchId || null,
    providerAlias,
    totalCount: totalCount ?? 0,
    selectedCount: selectedCount ?? 0,
    status: "preview",
    createdAt: new Date().toISOString(),
    committedAt: null,
    rollbackAt: null,
  };
  db.run(
    `INSERT INTO importSessions(id, connectionId, discoveryBatchId, providerAlias, totalCount, selectedCount, status, createdAt, committedAt, rollbackAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.connectionId, session.discoveryBatchId, session.providerAlias, session.totalCount, session.selectedCount, session.status, session.createdAt, session.committedAt, session.rollbackAt]
  );
  return session;
}

export async function getImportSession(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM importSessions WHERE id = ?`, [id]);
  return rowToImportSession(row);
}

export async function commitImportSession(id) {
  const db = await getAdapter();
  const res = db.run(`UPDATE importSessions SET status = 'committed', committedAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
  return (res?.changes ?? 0) > 0;
}

export async function rollbackImportSession(id) {
  const db = await getAdapter();
  const res = db.run(`UPDATE importSessions SET status = 'rolled_back', rollbackAt = ? WHERE id = ?`, [new Date().toISOString(), id]);
  return (res?.changes ?? 0) > 0;
}

// Batch-add custom models inside a single transaction; returns { written, skipped, results }.
export async function batchAddCustomModels(addCustomModel, records) {
  const db = await getAdapter();
  const results = [];
  db.transaction(() => {
    for (const r of records) {
      let written = false;
      try {
        written = addCustomModel(r);
      } catch (_) {
        // skip duplicates
      }
      results.push({ canonicalId: r.canonicalId, written });
    }
  });
  return results;
}
