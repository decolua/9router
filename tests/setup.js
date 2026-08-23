import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the SQLite layer at a throwaway directory for the whole run.
//
// Without this, anything that reaches the DB from a unit test lands in the
// developer's real router state — `~/.9router/db/data.sqlite` — and running
// the suite migrates and writes the database a live gateway is serving from.
// That became reachable on 2026-08-23, when model health started persisting at
// the routing seam: every combo test that fails a model now writes a row.
//
// Set before any import so `src/lib/dataDir.js`, which resolves DATA_DIR once
// at module load, sees it. Tests that manage their own DATA_DIR (db-*.test.js)
// still override it themselves and are unaffected — this only supplies a safe
// default for the ones that never meant to touch a database at all.
if (!process.env.DATA_DIR) {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "9router-tests-"));
}
