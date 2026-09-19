// F8 M-4: exportDb/importDb must cover the `disabledModels` kv scope, and the
// round-trip must be symmetric (import(payload) -> export() == payload for that
// scope). Backups without the field (legacy) must still import cleanly.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f8-expimp-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi_resetModules();
});

afterEach(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// keep the resetModules call vitest-import-free at the top
import { vi } from "vitest";
function vi_resetModules() { vi.resetModules(); }

async function db() {
  return await import("@/lib/db/index.js");
}

describe("exportDb/importDb include disabledModels (M-4)", () => {
  it("exportDb output contains the disabledModels scope", async () => {
    const d = await db();
    await d.disableModels("openrouter", ["moonshotai/kimi-k2", "some/model"]);
    await d.disableModels("opencode", ["glm-4.5"] );
    const out = await d.exportDb();
    expect(out.disabledModels).toEqual({
      openrouter: ["moonshotai/kimi-k2", "some/model"],
      opencode: ["glm-4.5"],
    });
  });

  it("importDb restores disabledModels and its return value matches a fresh export (symmetric round-trip)", async () => {
    const d = await db();
    await d.disableModels("openrouter", ["a/one", "a/two"]);
    const snap1 = await d.exportDb();
    expect(snap1.disabledModels).toEqual({ openrouter: ["a/one", "a/two"] });

    // mutate live state: enable one, disable on another provider
    await d.enableModels("openrouter", ["a/two"]);
    await d.disableModels("nvidia", ["n/x"]);
    expect(await d.getDisabledModels()).toEqual({ openrouter: ["a/one"], nvidia: ["n/x"] });

    const snap2 = await d.importDb(snap1);
    // importDb returns the re-exported DB state: it must equal what was imported
    expect(snap2.disabledModels).toEqual(snap1.disabledModels);
    expect(await d.getDisabledModels()).toEqual({ openrouter: ["a/one", "a/two"] });

    // and the whole payload round-trips identically (import is a full replace)
    const snap3 = await d.exportDb();
    expect(snap3).toEqual(snap2);
  });

  it("importDb wipes the disabledModels scope like every other scope (full-replace semantics)", async () => {
    const d = await db();
    await d.disableModels("openrouter", ["x/y"]);
    const empty = await d.exportDb();
    empty.disabledModels = {}; // simulate a backup taken before anything was disabled
    await d.importDb(empty);
    expect(await d.getDisabledModels()).toEqual({});
  });

  it("legacy backup without the disabledModels field imports without throwing (back-compat)", async () => {
    const d = await db();
    await d.disableModels("openrouter", ["keep/me"]);
    const legacy = await d.exportDb();
    delete legacy.disabledModels;
    const out = await d.importDb(legacy);
    expect(out.disabledModels).toEqual({}); // field absent → nothing to restore
    expect(typeof out.settings).toBe("object");
  });

  it("pre-existing scopes still round-trip after the change (modelAliases + customModels)", async () => {
    const d = await db();
    await d.disableModels("openrouter", ["m/1"]);
    const snap = await d.exportDb();
    const snap2 = await d.importDb(snap);
    expect(snap2.disabledModels).toEqual(snap.disabledModels);
    expect(snap2.modelAliases).toEqual(snap.modelAliases);
    expect(snap2.customModels).toEqual(snap.customModels);
    expect(snap2.pricing).toEqual(snap.pricing);
    expect(snap2.mitmAlias).toEqual(snap.mitmAlias);
  });
});
