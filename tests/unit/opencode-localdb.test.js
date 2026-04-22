import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("localDb opencode sync helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATA_DIR;
  });

  it("creates default opencodeSync domain when db shape is empty", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-opencode-db-"));
    process.env.DATA_DIR = dataDir;

    const dbPath = path.join(dataDir, "db.json");
    fs.writeFileSync(dbPath, JSON.stringify({ providerConnections: [] }, null, 2));

    const { getDb, getOpenCodePreferences } = await import("../../src/lib/localDb.js");
    const db = await getDb();

    expect(db.data.opencodeSync).toBeUndefined();
    expect(await getOpenCodePreferences()).toMatchObject({ variant: "openagent" });
    expect(db.data.opencodeSync).toBeDefined();
  });

  it("normalizes preferences and keeps tokens through import/export", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-opencode-import-"));
    process.env.DATA_DIR = dataDir;

    const {
      exportDb,
      getOpenCodePreferences,
      importDb,
      listOpenCodeTokens,
      replaceOpenCodeTokens,
      updateOpenCodePreferences,
    } = await import("../../src/lib/localDb.js");

    const updated = await updateOpenCodePreferences({
      customPlugins: ["foo@latest", "foo@latest", "bar@latest"],
      envVars: [
        { key: "B", value: "1", secret: false },
        { key: "A", value: "2", secret: true },
        { key: "A", value: "3", secret: true },
      ],
    });

    await replaceOpenCodeTokens([{ id: "token-1", label: "Laptop" }]);

    expect(updated.customPlugins).toEqual(["foo@latest", "bar@latest"]);
    expect(updated.envVars).toEqual([
      { key: "A", value: "3", secret: true },
      { key: "B", value: "1", secret: false },
    ]);

    const exported = await exportDb();
    expect(exported.opencodeSync).toMatchObject({
      preferences: {
        variant: "openagent",
      },
      tokens: [{ id: "token-1", label: "Laptop" }],
    });

    await importDb({
      settings: { cloudEnabled: true },
      opencodeSync: {
        preferences: { variant: "custom", customTemplate: "minimal" },
        tokens: [{ id: "token-2", label: "Desktop" }],
      },
    });

    expect(await getOpenCodePreferences()).toMatchObject({
      variant: "custom",
      customTemplate: "minimal",
    });
    expect(await listOpenCodeTokens()).toEqual([{ id: "token-2", label: "Desktop" }]);
  });
});
