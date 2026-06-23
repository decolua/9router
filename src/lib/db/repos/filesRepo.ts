import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "../driver.js";
import { getAdapter } from "../driver.js";

export interface FileMeta {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string | null;
  purpose: string | null;
  status: string;
  content_type: string | null;
}

export interface FileContent {
  buffer: Buffer;
  contentType: string | null;
  filename: string | null;
}

function rowToMeta(row: Record<string, unknown> | undefined): FileMeta | null {
  if (!row) return null;
  return {
    id: row["id"] as string,
    object: "file",
    bytes: row["bytes"] as number,
    created_at: row["createdAt"] as number,
    filename: (row["filename"] as string | null) ?? null,
    purpose: (row["purpose"] as string | null) ?? null,
    status: row["status"] as string,
    content_type: (row["contentType"] as string | null) ?? null,
  };
}

export async function createFile({ buffer, filename, purpose, contentType }: {
  buffer: Buffer;
  filename?: string | null;
  purpose?: string | null;
  contentType?: string | null;
}) {
  const db: DbAdapter = await getAdapter();
  const id = `file-${uuidv4().replace(/-/g, "").slice(0, 24)}`;
  const createdAt = Math.floor(Date.now() / 1000);
  db.run(
    `INSERT INTO files(id, bytes, createdAt, filename, purpose, status, contentType, content)
     VALUES(?, ?, ?, ?, ?, 'processed', ?, ?)`,
    [id, buffer.length, createdAt, filename ?? null, purpose ?? null, contentType ?? null, buffer],
  );
  return rowToMeta(db.get(`SELECT * FROM files WHERE id = ?`, [id]));
}

export async function getFile(id: string) {
  const db: DbAdapter = await getAdapter();
  return rowToMeta(db.get(`SELECT * FROM files WHERE id = ?`, [id]));
}

export async function listFiles({ purpose }: { purpose?: string } = {}) {
  const db: DbAdapter = await getAdapter();
  if (purpose) {
    return db.all(`SELECT * FROM files WHERE purpose = ? ORDER BY createdAt DESC`, [purpose]).map(rowToMeta).filter((f): f is FileMeta => f !== null);
  }
  return db.all(`SELECT * FROM files ORDER BY createdAt DESC`).map(rowToMeta).filter((f): f is FileMeta => f !== null);
}

export async function deleteFile(id: string) {
  const db: DbAdapter = await getAdapter();
  let removed: { id: string; object: "file"; deleted: true } | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT id FROM files WHERE id = ?`, [id]);
    if (!row) return;
    removed = { id, object: "file", deleted: true };
    db.run(`DELETE FROM files WHERE id = ?`, [id]);
  });
  return removed;
}

export async function getFileContent(id: string): Promise<FileContent | null> {
  const db: DbAdapter = await getAdapter();
  const row = db.get(`SELECT content, contentType, filename FROM files WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    buffer: row["content"] as Buffer,
    contentType: (row["contentType"] as string | null) ?? null,
    filename: (row["filename"] as string | null) ?? null,
  };
}
