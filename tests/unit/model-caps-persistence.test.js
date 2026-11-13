import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
let tempDir;
const originalDataDir = process.env.DATA_DIR;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-caps-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});
afterEach(() => {
  global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  fs.rmSync(tempDir, {
    recursive: true,
    force: true
  });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;else process.env.DATA_DIR = originalDataDir;
});
it("round trips model caps and custom model imports through the real DB", async () => {
  const db = await import("@/lib/db/index.js");
  await db.setCapsOverride("openai", "fixture", {
    contextWindow: 32000,
    vision: false
  });
  await db.addCustomModelsBulk({
    providerAlias: "openai",
    ids: ["fixture"],
    type: "llm"
  });
  const duplicate = await db.addCustomModelsBulk({
    providerAlias: "openai",
    ids: ["fixture", "other"],
    type: "llm"
  });
  expect(duplicate).toMatchObject({
    added: 1,
    skipped: 1
  });
  const backup = await db.exportDb();
  await db.deleteCapsOverride("openai", "fixture");
  await db.importDb(backup);
  expect(await db.getCapsOverrides()).toEqual({
    "openai|fixture": {
      contextWindow: 32000,
      vision: false
    }
  });
  expect((await db.exportDb()).customModels).toEqual(backup.customModels);
  delete backup.modelCaps;
  await db.importDb(backup);
  expect(await db.getCapsOverrides()).toEqual({});
});
