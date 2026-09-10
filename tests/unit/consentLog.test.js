import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIGRATIONS } from "../../src/lib/db/migrations/index.js";
import { logConsent, getConsentLog } from "../../src/lib/db/repos/consentLogRepo.js";

// Isolated via temp DATA_DIR like the other DB tests (db-migration-chain, etc.).
const originalDataDir = process.env.DATA_DIR;
let tempDir;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "consentlog-test-"));
  process.env.DATA_DIR = tempDir;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("consent_log", () => {
  it("migration 002 is registered", () => {
    const m = MIGRATIONS.find((x) => x.version === 2);
    expect(m).toBeTruthy();
    expect(m.name).toBe("consent-log");
    expect(typeof m.up).toBe("function");
  });

  it("round-trips accepted + revoked entries, newest first", async () => {
    await logConsent({ user: "alice@example.com", hostname: "host-a", action: "accepted" });
    await logConsent({ user: "bob", hostname: "host-b", action: "revoked" });
    const entries = await getConsentLog();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    // newest first ordering
    expect(entries[0].action).toBe("revoked");
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].id).toBeGreaterThan(entries[i].id);
    }
    const latest = entries[0];
    expect(latest.user).toBe("bob");
    expect(latest.hostname).toBe("host-b");
    expect(latest.createdAt).toBeTruthy();
  });

  it("respects the limit parameter without deleting stored rows", async () => {
    for (let i = 0; i < 3; i++) {
      await logConsent({ user: `u${i}`, hostname: "h", action: "accepted" });
    }
    const limited = await getConsentLog({ limit: 2 });
    expect(limited.length).toBe(2);
    const all = await getConsentLog();
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects invalid actions without throwing", async () => {
    await expect(logConsent({ action: "bogus" })).resolves.toBeNull();
  });
});