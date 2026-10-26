import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// #4915: deleting the last connection of a provider must drop that provider's
// explicit members from combos; other accounts or providers must be untouched.
describe("deleteProviderConnection combo cascade", () => {
  let dir, repo, combos;
  const orig = process.env.DATA_DIR;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cascade-"));
    process.env.DATA_DIR = dir;
    // The DB adapter is a process-wide singleton; drop it so each case gets a fresh DB.
    delete global._dbAdapter;
    vi.resetModules();
    repo = await import("@/lib/db/repos/connectionsRepo.js");
    combos = await import("@/lib/db/repos/combosRepo.js");
  });

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch { /* already closed */ }
    delete global._dbAdapter;
    process.env.DATA_DIR = orig;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const conn = (provider, name) =>
    repo.createProviderConnection({ provider, authType: "apikey", name, apiKey: "k" });

  it("keeps members while another connection of the provider remains", async () => {
    const a = await conn("openrouter", "a");
    await conn("openrouter", "b");
    const c = await combos.createCombo({ name: "c1", models: ["openrouter/x", "groq/y"] });
    expect(await repo.deleteProviderConnection(a.id)).toBe(true);
    expect((await combos.getComboById(c.id)).models).toEqual(["openrouter/x", "groq/y"]);
  });

  it("drops members of the last connection, keeps aliases and other providers", async () => {
    const a = await conn("openrouter", "a");
    const c = await combos.createCombo({ name: "c2", models: ["openrouter/x", "groq/y", "my-alias"] });
    const solo = await combos.createCombo({ name: "c3", models: ["openrouter/z"] });
    expect(await repo.deleteProviderConnection(a.id)).toBe(true);
    expect((await combos.getComboById(c.id)).models).toEqual(["groq/y", "my-alias"]);
    expect((await combos.getComboById(solo.id)).models).toEqual([]);
  });

  it("returns false for an unknown id", async () => {
    expect(await repo.deleteProviderConnection("nope")).toBe(false);
  });
});
