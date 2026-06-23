import type { Migration } from "./001-initial.js";

const m006Files: Migration = {
  version: 6,
  name: "files",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        bytes INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        filename TEXT,
        purpose TEXT,
        status TEXT NOT NULL DEFAULT 'processed',
        contentType TEXT,
        content BLOB NOT NULL
      );
    `);
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_files_purpose ON files(purpose)`);
    } catch (e) {
      if (!/already exists/i.test(String((e as Error)?.message ?? ""))) throw e;
    }
  },
};
export default m006Files;
