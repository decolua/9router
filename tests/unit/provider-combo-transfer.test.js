import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
let db;
const originalDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-transfer-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("provider + combo selective transfer", () => {
  it("exports selected records and closes over routing dependencies", async () => {
    const node = await db.createProviderNode({
      type: "openai-compatible",
      name: "Personal",
      prefix: "personal",
      apiType: "openai",
      baseUrl: "https://example.test/v1",
    });
    const connection = await db.createProviderConnection({
      provider: node.id,
      authType: "apikey",
      name: "Personal key",
      apiKey: "secret",
      testStatus: "error",
      providerSpecificData: { proxyPoolId: "local-pool", tenant: "portable" },
    });
    const combo = await db.createCombo({ name: "coding", kind: "llm", models: ["personal/model-a"] });
    await db.addCustomModel({ providerAlias: "personal", id: "model-a", type: "llm", name: "Model A" });
    await db.setModelAlias("personal/model-a", "my-model");
    await db.updateSettings({ comboStrategies: { coding: { fallbackStrategy: "round-robin" } } });

    const bundle = await db.createTransferBundle({
      providerConnectionIds: [connection.id],
      comboIds: [combo.id],
    });

    expect(bundle.format).toBe("9router-provider-combo-transfer");
    expect(bundle.providerConnections).toHaveLength(1);
    expect(bundle.providerConnections[0]).not.toHaveProperty("priority");
    expect(bundle.providerConnections[0]).not.toHaveProperty("isActive");
    expect(bundle.providerConnections[0]).not.toHaveProperty("testStatus");
    expect(bundle.providerConnections[0].providerSpecificData).toEqual({ tenant: "portable" });
    expect(bundle.providerNodes.map((item) => item.id)).toContain(node.id);
    expect(bundle.customModels).toHaveLength(1);
    expect(bundle.modelAliases).toEqual({ "personal/model-a": "my-model" });
    expect(bundle.comboStrategies.coding.fallbackStrategy).toBe("round-robin");

    const fullBackupPlan = await db.planSelectiveTransfer(await db.exportDb());
    expect(fullBackupPlan.summary.providerConnections).toBeGreaterThanOrEqual(1);
    expect(fullBackupPlan.summary.combos).toBeGreaterThanOrEqual(1);
  });

  it("replaces credentials and merges combos without overwriting target policy", async () => {
    const target = await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "user@example.test",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      testStatus: "connected",
      isActive: false,
      providerSpecificData: { chatgptAccountId: "workspace-1", proxyPoolId: "target-pool" },
    });
    await db.updateProviderConnection(target.id, { isActive: false });
    const originalPriority = (await db.getProviderConnectionById(target.id)).priority;
    const targetCombo = await db.createCombo({ name: "coding", kind: "llm", models: ["codex/model-a"] });
    await db.updateSettings({ comboStrategies: { coding: { fallbackStrategy: "fallback" } } });

    const payload = {
      format: "9router-provider-combo-transfer",
      version: 1,
      providerConnections: [{
        id: "source-account",
        provider: "codex",
        authType: "oauth",
        email: "user@example.test",
        name: "Imported",
        accessToken: "new-access",
        refreshToken: "new-refresh",
        providerSpecificData: { chatgptAccountId: "workspace-1", proxyPoolId: "source-pool" },
      }],
      combos: [{ id: "source-combo", name: "coding", kind: "llm", models: ["codex/model-b"] }],
      comboStrategies: { coding: { fallbackStrategy: "round-robin" } },
    };

    const plan = await db.planSelectiveTransfer(payload);
    expect(plan.providerConnections[0]).toMatchObject({ status: "conflict", targetId: target.id });
    expect(plan.combos[0]).toMatchObject({ status: "conflict", targetId: targetCombo.id });
    expect(plan.summary.deletions).toBe(0);
    expect(JSON.stringify(plan)).not.toContain("new-access");
    expect(JSON.stringify(plan)).not.toContain("new-refresh");

    const result = await db.applySelectiveTransfer(payload, {
      "provider:source-account": { action: "replace" },
      "combo:source-combo": { action: "merge" },
    });
    expect(result.deletions).toBe(0);

    const updated = await db.getProviderConnectionById(target.id);
    expect(updated.accessToken).toBe("new-access");
    expect(updated.refreshToken).toBe("new-refresh");
    expect(updated.priority).toBe(originalPriority);
    expect(updated.isActive).toBe(false);
    expect(updated.providerSpecificData.proxyPoolId).toBe("target-pool");
    expect(updated.providerSpecificData.chatgptAccountId).toBe("workspace-1");
    expect(updated.testStatus).toBe("connected");
    expect((await db.getComboById(targetCombo.id)).models).toEqual(["codex/model-a", "codex/model-b"]);
    expect((await db.getSettings()).comboStrategies.coding.fallbackStrategy).toBe("fallback");
  });

  it("keeps same-email Codex workspaces separate and rolls back a failed apply", async () => {
    await db.createProviderConnection({
      provider: "codex",
      authType: "oauth",
      email: "same@example.test",
      accessToken: "one",
      providerSpecificData: { chatgptAccountId: "workspace-a" },
    });
    await db.createCombo({ name: "existing", models: ["codex/model-a"] });
    const payload = {
      format: "9router-provider-combo-transfer",
      version: 1,
      providerConnections: [{
        id: "workspace-b-source",
        provider: "codex",
        authType: "oauth",
        email: "same@example.test",
        accessToken: "two",
        providerSpecificData: { chatgptAccountId: "workspace-b" },
      }],
      combos: [{ id: "combo-source", name: "existing", models: ["codex/model-b"] }],
    };
    expect((await db.planSelectiveTransfer(payload)).providerConnections[0].status).toBe("new");

    await expect(db.applySelectiveTransfer(payload, {
      "provider:workspace-b-source": { action: "add" },
      "combo:combo-source": { action: "rename", renameTo: "invalid name" },
    })).rejects.toThrow("valid new name");

    const accounts = await db.getProviderConnections({ provider: "codex" });
    expect(accounts).toHaveLength(1);
    expect((await db.getComboByName("existing")).models).toEqual(["codex/model-a"]);
  });

  it("rejects duplicate source identities before planning", async () => {
    const duplicate = {
      format: "9router-provider-combo-transfer",
      version: 1,
      providerConnections: [
        { id: "duplicate", provider: "openrouter", authType: "apikey", name: "one", apiKey: "a" },
        { id: "duplicate", provider: "openrouter", authType: "apikey", name: "two", apiKey: "b" },
      ],
    };
    await expect(db.planSelectiveTransfer(duplicate)).rejects.toThrow("duplicate identity");
    expect(await db.getProviderConnections({ provider: "openrouter" })).toHaveLength(0);
  });
});
