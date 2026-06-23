// OpenAI Files API storage — uploaded blobs (vision/file inputs).
// Idempotent: CREATE TABLE IF NOT EXISTS.
const m006Files = {
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
      if (!/already exists/i.test(String(e?.message || ""))) throw e;
    }
  },
};
export default m006Files;
