import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-passkeys-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("passkeys repo", () => {
  it("stores, updates, renames and deletes credentials", async () => {
    expect(await db.countPasskeys()).toBe(0);

    const created = await db.createPasskey({
      id: "cred-1",
      publicKey: "pk",
      counter: 0,
      transports: ["internal", "hybrid"],
      rpId: "router.example.com",
      name: "MacBook",
      deviceType: "multiDevice",
      backedUp: true,
    });
    expect(created).toMatchObject({
      id: "cred-1",
      transports: ["internal", "hybrid"],
      backedUp: true,
      lastUsedAt: null,
    });
    expect(await db.countPasskeys()).toBe(1);

    expect(await db.updatePasskeyUsage("cred-1", 7)).toBe(true);
    const used = await db.getPasskeyById("cred-1");
    expect(used.counter).toBe(7);
    expect(used.lastUsedAt).toBeTruthy();

    expect((await db.renamePasskey("cred-1", "Work laptop")).name).toBe("Work laptop");
    expect(await db.renamePasskey("missing", "x")).toBeNull();

    expect(await db.deletePasskey("cred-1")).toBe(true);
    expect(await db.deletePasskey("cred-1")).toBe(false);
    expect(await db.getPasskeys()).toEqual([]);
  });

  it("counts only passkeys usable from a remote address", async () => {
    await db.createPasskey({ id: "local-1", publicKey: "pk", rpId: "localhost" });
    await db.createPasskey({ id: "local-2", publicKey: "pk", rpId: "router.localhost" });
    expect(await db.countPasskeys()).toBe(2);
    expect(await db.countRemotePasskeys()).toBe(0);

    await db.createPasskey({ id: "remote-1", publicKey: "pk", rpId: "router.example.com" });
    expect(await db.countRemotePasskeys()).toBe(1);

    for (const id of ["local-1", "local-2", "remote-1"]) await db.deletePasskey(id);
  });

  it("keeps passkeys out of settings and database exports", async () => {
    await db.createPasskey({ id: "cred-2", publicKey: "pk", rpId: "router.example.com" });

    const settings = await db.getSettings();
    expect(settings.passkeyMode).toBe("off");
    expect(JSON.stringify(settings)).not.toContain("cred-2");

    const exported = await db.exportDb();
    expect(JSON.stringify(exported)).not.toContain("cred-2");
  });
});
