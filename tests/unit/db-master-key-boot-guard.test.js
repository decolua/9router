import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { _resetCacheForTests } from "@/lib/crypto/masterKey.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalMasterKey = process.env.MASTER_KEY;

const KEY_A = Buffer.alloc(32, 11).toString("base64");
const KEY_B = Buffer.alloc(32, 22).toString("base64");

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-mkg-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  _resetCacheForTests();
  vi.resetModules();
});

function releaseDb() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
    global._dbAdapter.logged = false;
  }
}

afterEach(() => {
  releaseDb();
  delete global._dbAdapter;
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  _resetCacheForTests();
  if (originalMasterKey === undefined) delete process.env.MASTER_KEY;
  else process.env.MASTER_KEY = originalMasterKey;
});

describe("MASTER_KEY boot guard", () => {
  it("stamps fingerprint when MASTER_KEY is set on fresh DB", async () => {
    process.env.MASTER_KEY = KEY_A;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key = 'masterKeyFingerprint'`);
    expect(row?.value).toBeTruthy();
    expect(row.value).toHaveLength(16);
  });

  it("refuses start when encrypted fingerprint exists but MASTER_KEY is missing", async () => {
    process.env.MASTER_KEY = KEY_A;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const fp = db.get(`SELECT value FROM _meta WHERE key = 'masterKeyFingerprint'`).value;
    releaseDb();
    _resetCacheForTests();
    delete process.env.MASTER_KEY;
    vi.resetModules();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    await expect(getAdapter2()).rejects.toThrow(/MASTER_KEY is not set/i);
    expect(fp).toBeTruthy();
  });

  it("refuses start on MASTER_KEY mismatch", async () => {
    process.env.MASTER_KEY = KEY_A;
    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();
    releaseDb();
    _resetCacheForTests();
    process.env.MASTER_KEY = KEY_B;
    vi.resetModules();

    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    await expect(getAdapter2()).rejects.toThrow(/MASTER_KEY mismatch/i);
  });
});
