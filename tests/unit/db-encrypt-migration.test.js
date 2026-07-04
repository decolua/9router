import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isEncrypted } from "@/lib/crypto/envelope.js";
import { _resetCacheForTests } from "@/lib/crypto/masterKey.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalMasterKey = process.env.MASTER_KEY;

const MASTER_KEY = Buffer.alloc(32, 77).toString("base64");

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-enc-"));
  process.env.DATA_DIR = tempDir;
  process.env.MASTER_KEY = MASTER_KEY;
  delete global._dbAdapter;
  _resetCacheForTests();
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  _resetCacheForTests();
  if (originalMasterKey === undefined) delete process.env.MASTER_KEY;
  else process.env.MASTER_KEY = originalMasterKey;
});

describe("migration 002 encrypt-secrets", () => {
  it("encrypts settings, connections, and api keys when MASTER_KEY is set", async () => {
    const legacy = {
      settings: { oidcClientSecret: "top-secret" },
      providerConnections: [{
        id: "pc1",
        provider: "openai",
        authType: "oauth",
        accessToken: "tok",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      apiKeys: [{ id: "k1", key: "sk-test-key", name: "dev", createdAt: new Date().toISOString() }],
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    const settings = db.get(`SELECT data FROM settings LIMIT 1`);
    expect(isEncrypted(settings.data)).toBe(true);

    const conn = db.get(`SELECT data FROM providerConnections WHERE id = 'pc1'`);
    expect(isEncrypted(conn.data)).toBe(true);

    const keyRow = db.get(`SELECT key, keyHash FROM apiKeys WHERE id = 'k1'`);
    expect(isEncrypted(keyRow.key)).toBe(true);
    expect(keyRow.keyHash).toMatch(/^[a-f0-9]{64}$/);

    const fp = db.get(`SELECT value FROM _meta WHERE key = 'masterKeyFingerprint'`);
    expect(fp?.value).toHaveLength(16);

    const enabledAt = db.get(`SELECT value FROM _meta WHERE key = 'encryptionEnabledAt'`);
    expect(enabledAt?.value).toBeTruthy();
  });

  it("validateApiKey works via keyHash after encryption", async () => {
    const legacy = {
      apiKeys: [{ id: "k1", key: "sk-lookup-test", name: "dev", createdAt: new Date().toISOString() }],
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));

    const { getAdapter } = await import("@/lib/db/driver.js");
    await getAdapter();

    const { validateApiKey } = await import("@/lib/db/repos/apiKeysRepo.js");
    const ok = await validateApiKey("sk-lookup-test");
    expect(ok?.valid).toBe(true);
    const bad = await validateApiKey("sk-wrong");
    expect(bad).toBe(false);
  });
});
