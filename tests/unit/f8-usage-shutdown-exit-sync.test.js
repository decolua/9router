// F8 L-1: the requestDetailsRepo "exit" handler used to start an ASYNC flush
// that can never complete — during "exit" the event loop is already stopped.
// The registered exit handler must persist the buffer synchronously.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalLogs = process.env.ENABLE_REQUEST_LOGS;
let addedExitListeners = [];
let addedBeforeExitListeners = [];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f8-exit-"));
  process.env.DATA_DIR = tempDir;
  process.env.ENABLE_REQUEST_LOGS = "true";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(async () => {
  // don't leak module-owned handlers into other tests of this file
  for (const l of addedExitListeners) process.off("exit", l);
  for (const l of addedBeforeExitListeners) process.off("beforeExit", l);
  addedExitListeners = [];
  addedBeforeExitListeners = [];
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalLogs;
});

describe("requestDetails exit handler is sync-safe (L-1)", () => {
  it("running the registered exit handlers writes buffered details to the DB synchronously", async () => {
    const exitBefore = process.listeners("exit");
    const beforeExitBefore = process.listeners("beforeExit");

    const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    addedExitListeners = process.listeners("exit").filter((l) => !exitBefore.includes(l));
    addedBeforeExitListeners = process.listeners("beforeExit").filter((l) => !beforeExitBefore.includes(l));
    // the module must keep an exit hook (one-off scripts call process.exit()),
    // and it must be the one that actually flushes
    expect(addedExitListeners.length).toBeGreaterThanOrEqual(1);

    await repo.saveRequestDetail({
      model: "gpt-test", provider: "openai", status: 200,
      request: { hello: "world" }, response: { ok: true },
    });

    const db = await getAdapter();
    // buffered, not yet flushed (batchSize 20 not reached, timer still pending)
    expect(db.all(`SELECT id FROM requestDetails`).length).toBe(0);

    // simulate the real event: Node calls "exit" listeners synchronously and
    // resolves nothing afterwards. No await allowed in this window.
    for (const handler of addedExitListeners) handler(0);

    // The fix: the detail is in the DB RIGHT NOW (synchronous flush).
    const rows = db.all(`SELECT id, data FROM requestDetails`);
    expect(rows.length).toBe(1);
    expect(rows[0].data).toContain("gpt-test");
  });

  it("exit handler is a no-op (and does not throw) when nothing is buffered", async () => {
    const exitBefore = process.listeners("exit");
    await import("@/lib/db/repos/requestDetailsRepo.js");
    addedExitListeners = process.listeners("exit").filter((l) => !exitBefore.includes(l));
    expect(() => { for (const h of addedExitListeners) h(0); }).not.toThrow();
  });

  it("beforeExit hook still exists for event-loop drain", async () => {
    const beforeExitBefore = process.listeners("beforeExit");
    await import("@/lib/db/repos/requestDetailsRepo.js");
    addedBeforeExitListeners = process.listeners("beforeExit").filter((l) => !beforeExitBefore.includes(l));
    expect(addedBeforeExitListeners.length).toBeGreaterThanOrEqual(1);
  });
});
