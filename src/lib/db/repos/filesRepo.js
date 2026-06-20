import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

// OpenAI Files API storage. Blobs stored as BLOB; returned metadata excludes content.

function rowToMeta(row) {
  if (!row) return null;
  return {
    id: row.id,
    object: "file",
    bytes: row.bytes,
    created_at: row.createdAt,
    filename: row.filename,
    purpose: row.purpose,
    status: row.status,
    content_type: row.contentType,
  };
}

export async function createFile({ buffer, filename, purpose, contentType }) {
  const db = await getAdapter();
  const id = `file-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  db.run(
    `INSERT INTO files(id, bytes, createdAt, filename, purpose, status, contentType, content)
     VALUES(?, ?, ?, ?, ?, 'processed', ?, ?)`,
    [id, buffer.length, createdAt, filename ?? null, purpose ?? null, contentType ?? null, buffer]
  );
  return rowToMeta(db.get(`SELECT * FROM files WHERE id = ?`, [id]));
}

export async function getFile(id) {
  const db = await getAdapter();
  return rowToMeta(db.get(`SELECT * FROM files WHERE id = ?`, [id]));
}

export async function listFiles({ purpose } = {}) {
  const db = await getAdapter();
  if (purpose) {
    return db.all(`SELECT * FROM files WHERE purpose = ? ORDER BY createdAt DESC`, [purpose]).map(rowToMeta);
  }
  return db.all(`SELECT * FROM files ORDER BY createdAt DESC`).map(rowToMeta);
}

export async function deleteFile(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT id FROM files WHERE id = ?`, [id]);
    if (!row) return;
    removed = { id, object: "file", deleted: true };
    db.run(`DELETE FROM files WHERE id = ?`, [id]);
  });
  return removed;
}

export async function getFileContent(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT content, contentType, filename FROM files WHERE id = ?`, [id]);
  if (!row) return null;
  return { buffer: row.content, contentType: row.contentType, filename: row.filename };
}
