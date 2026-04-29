// Manual trigger: import legacy config (db.json) into SQLite.
// Usage/request-details JSON are log data — intentionally NOT migrated:
// re-running would duplicate history rows (AUTOINCREMENT PK, no dedupe key).
// Config uses INSERT OR REPLACE so re-runs are idempotent.

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getDatabase, DATA_DIR } from "@/lib/sqlite/connection.js";
import { migrateFromJson } from "@/lib/sqlite/migrate-from-json.js";

const CONFIG_FILE = "db.json";
const LOG_FILES = ["usage.json", "request-details.json"];

export async function GET() {
  try {
    const configPresent = fs.existsSync(path.join(DATA_DIR, CONFIG_FILE));
    return NextResponse.json({
      dataDir: DATA_DIR,
      legacyFilesFound: configPresent ? [CONFIG_FILE] : [],
      hasLegacyData: configPresent,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to inspect data dir" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const db = getDatabase();

    // Hide log files so migrateFromJson's fs.existsSync check skips them,
    // then restore so user can inspect/delete later.
    const renamed = [];
    for (const f of LOG_FILES) {
      const p = path.join(DATA_DIR, f);
      if (fs.existsSync(p)) {
        const tmp = `${p}.skip-${Date.now()}`;
        fs.renameSync(p, tmp);
        renamed.push({ tmp, original: p });
      }
    }

    let summary;
    try {
      summary = migrateFromJson(db, DATA_DIR);
    } finally {
      for (const r of renamed) {
        try {
          if (fs.existsSync(r.tmp)) fs.renameSync(r.tmp, r.original);
        } catch {}
      }
    }

    if (!summary || summary.imported === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        files: [],
        message: "No legacy config (db.json) found to migrate",
      });
    }

    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error("[migrate-sqlite] failed:", error);
    return NextResponse.json(
      { error: error?.message || "Migration failed" },
      { status: 500 }
    );
  }
}
