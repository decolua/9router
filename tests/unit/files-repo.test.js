import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-files-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("files repo (OpenAI Files storage)", () => {
  it("createFile stores a blob and returns OpenAI-shaped metadata", async () => {
    const buf = Buffer.from("hello world");
    const meta = await db.createFile({
      buffer: buf,
      filename: "test.txt",
      purpose: "vision",
      contentType: "text/plain",
    });
    expect(meta.id).toMatch(/^file-/);
    expect(meta.object).toBe("file");
    expect(meta.bytes).toBe(11);
    expect(meta.filename).toBe("test.txt");
    expect(meta.purpose).toBe("vision");
    expect(meta.status).toBe("processed");
  });

  it("getFile retrieves metadata by id", async () => {
    const meta = await db.createFile({ buffer: Buffer.from("abc"), filename: "a.bin", purpose: "fine-tune" });
    const got = await db.getFile(meta.id);
    expect(got.id).toBe(meta.id);
    expect(got.bytes).toBe(3);
  });

  it("getFile returns null for unknown id", async () => {
    expect(await db.getFile("file-nope")).toBe(null);
  });

  it("listFiles returns all, optionally filtered by purpose", async () => {
    await db.createFile({ buffer: Buffer.from("x"), filename: "p1", purpose: "assistants" });
    await db.createFile({ buffer: Buffer.from("y"), filename: "p2", purpose: "vision" });
    const all = await db.listFiles();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const vision = await db.listFiles({ purpose: "vision" });
    expect(vision.length).toBeGreaterThanOrEqual(1);
    expect(vision.every((f) => f.purpose === "vision")).toBe(true);
  });

  it("getFileContent returns the raw buffer + content type", async () => {
    const meta = await db.createFile({ buffer: Buffer.from([1, 2, 3, 4]), filename: "img.png", purpose: "vision", contentType: "image/png" });
    const content = await db.getFileContent(meta.id);
    expect(Buffer.isBuffer(content.buffer) || content.buffer instanceof Uint8Array).toBe(true);
    expect(Buffer.from(content.buffer)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(content.contentType).toBe("image/png");
    expect(content.filename).toBe("img.png");
  });

  it("deleteFile removes the row and returns deleted:true", async () => {
    const meta = await db.createFile({ buffer: Buffer.from("z"), filename: "d", purpose: "vision" });
    const res = await db.deleteFile(meta.id);
    expect(res).toEqual({ id: meta.id, object: "file", deleted: true });
    expect(await db.getFile(meta.id)).toBe(null);
  });

  it("deleteFile returns null for unknown id", async () => {
    expect(await db.deleteFile("file-missing")).toBe(null);
  });
});
