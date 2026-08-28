import { getAdapter } from "../driver.js";

// Tracks which provider/models the user has seen, powering the
// "New Models" discovery feature. A row exists for every model that has
// ever been observed (across every provider, incl. self-added compatible nodes).
// `acknowledged = 0` means the user has not dismissed the "new" badge yet.

export async function getSeenModels() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, providerAlias, modelId, isFree, firstSeenAt, acknowledged FROM seenModels`
  );
  const map = new Map();
  for (const r of rows) {
    map.set(r.id, {
      providerAlias: r.providerAlias,
      modelId: r.modelId,
      isFree: !!r.isFree,
      firstSeenAt: r.firstSeenAt,
      acknowledged: !!r.acknowledged,
    });
  }
  return map;
}

export async function getSeenModelsCount() {
  const db = await getAdapter();
  const row = db.get(`SELECT COUNT(*) as c FROM seenModels`);
  return row ? row.c : 0;
}

// Reconcile observed models against stored state.
// `observed` is an array of { providerAlias, modelId, isFree }.
// Returns { new: [...], unseen: [...], seeded: boolean } where:
//   new    → models never recorded before (genuinely new since last scan)
//   unseen → previously seen but not yet acknowledged
//   seeded → true on first-ever scan (all existing models inserted as acknowledged)
//
// On first scan (empty table), all models are inserted with acknowledged=1 so
// the user sees zero "new" models — only models that appear AFTER this point
// will show as genuinely new.
export async function reconcileSeenModels(observed) {
  const db = await getAdapter();
  const existing = await getSeenModels();
  const now = new Date().toISOString();
  const newModels = [];
  const unseen = [];
  let seeded = false;

  db.transaction(() => {
    const isFirstScan = existing.size === 0 && observed.length > 0;

    for (const m of observed) {
      const id = `${m.providerAlias}::${m.modelId}`;
      const prev = existing.get(id);
      if (!prev) {
        if (isFirstScan) {
          // First scan: seed all models as already acknowledged.
          // Only models appearing AFTER this scan will show as new.
          db.run(
            `INSERT INTO seenModels(id, providerAlias, modelId, isFree, firstSeenAt, acknowledged)
             VALUES(?, ?, ?, ?, ?, 1)`,
            [id, m.providerAlias, m.modelId, m.isFree ? 1 : 0, now]
          );
          seeded = true;
        } else {
          db.run(
            `INSERT INTO seenModels(id, providerAlias, modelId, isFree, firstSeenAt, acknowledged)
             VALUES(?, ?, ?, ?, ?, 0)`,
            [id, m.providerAlias, m.modelId, m.isFree ? 1 : 0, now]
          );
          newModels.push({ ...m, firstSeenAt: now, acknowledged: false });
        }
      } else if (!prev.acknowledged) {
        unseen.push({
          providerAlias: m.providerAlias,
          modelId: m.modelId,
          isFree: prev.isFree,
          firstSeenAt: prev.firstSeenAt,
          acknowledged: false,
        });
      }
    }
  });

  return { new: newModels, unseen, seeded };
}

// Mark specific models acknowledged. `items` is [{ providerAlias, modelId }]
// or omit/null to acknowledge ALL unseen models.
export async function acknowledgeModels(items) {
  const db = await getAdapter();
  if (!items || items.length === 0) {
    db.run(`UPDATE seenModels SET acknowledged = 1 WHERE acknowledged = 0`);
    return;
  }
  db.transaction(() => {
    for (const it of items) {
      const id = `${it.providerAlias}::${it.modelId}`;
      db.run(`UPDATE seenModels SET acknowledged = 1 WHERE id = ?`, [id]);
    }
  });
}

// Count of unseen (unacknowledged) models — for badge display.
export async function countUnseenModels() {
  const db = await getAdapter();
  const row = db.get(`SELECT COUNT(*) as c FROM seenModels WHERE acknowledged = 0`);
  return row ? row.c : 0;
}

// All currently-unseen (unacknowledged) models, regardless of whether they
// appear in the live scan right now. Used to power the "New Models" modal.
export async function getUnseenModels() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, providerAlias, modelId, isFree, firstSeenAt, acknowledged
     FROM seenModels WHERE acknowledged = 0`
  );
  return rows.map((r) => ({
    providerAlias: r.providerAlias,
    modelId: r.modelId,
    isFree: !!r.isFree,
    firstSeenAt: r.firstSeenAt,
    acknowledged: false,
  }));
}

// Seed the table with the current model set as already-seen (acknowledged=1).
// Used as a first-run baseline so a fresh table doesn't report every existing
// model as "new". Only models appearing AFTER seeding show as genuinely new.
export async function seedSeenModels(observed) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const m of observed) {
      const id = `${m.providerAlias}::${m.modelId}`;
      db.run(
        `INSERT OR IGNORE INTO seenModels(id, providerAlias, modelId, isFree, firstSeenAt, acknowledged)
         VALUES(?, ?, ?, ?, ?, 1)`,
        [id, m.providerAlias, m.modelId, m.isFree ? 1 : 0, now]
      );
    }
  });
}
