import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-intelligence-db-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("intelligence combo persistence", () => {
  it("persists range, schedule, and matched models through the combos repository", async () => {
    const { createCombo, getComboById, updateCombo } = await import("@/lib/db/repos/combosRepo.js");
    const config = {
      type: "intelligence",
      minScore: 60,
      maxScore: 70,
      limit: 3,
      refreshSchedule: "daily",
      lastRefreshedAt: "2026-10-08T00:00:00.000Z",
      matchedDetails: [{ model: "openai/gpt-5", score: 70 }],
    };
    const created = await createCombo({ name: "top-intelligence", models: ["openai/gpt-5"], config });

    expect(await getComboById(created.id)).toMatchObject({
      name: "top-intelligence",
      models: ["openai/gpt-5"],
      config,
    });

    const updated = await updateCombo(created.id, { models: ["anthropic/claude-sonnet-4-5"] });
    expect(updated).toMatchObject({
      models: ["anthropic/claude-sonnet-4-5"],
      config,
    });
  });

  it("does not overwrite an intelligence config when its expected version is stale", async () => {
    const { createCombo, getComboById, updateCombo } = await import("@/lib/db/repos/combosRepo.js");
    const config = { type: "intelligence", minScore: 60, maxScore: 70, refreshSchedule: "daily" };
    const created = await createCombo({ name: "stale-refresh", models: ["openai/gpt-5"], config });

    await new Promise((resolve) => setTimeout(resolve, 2));
    const edited = await updateCombo(created.id, {
      config: { ...config, minScore: 65 },
      models: ["anthropic/claude-sonnet-4-5"],
    });
    const staleRefresh = await updateCombo(
      created.id,
      { config: { ...config, lastRefreshedAt: "2026-10-08T00:00:00.000Z" }, models: ["openai/gpt-5"] },
      { expectedUpdatedAt: created.updatedAt }
    );

    expect(staleRefresh).toBeNull();
    expect(await getComboById(created.id)).toMatchObject({
      updatedAt: edited.updatedAt,
      models: ["anthropic/claude-sonnet-4-5"],
      config: { ...config, minScore: 65 },
    });
  });
});
