import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-orgiso-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("multi-org isolation", () => {
  it("does not leak tenant data across orgs", async () => {
    const db = await import("@/lib/db/index.js");
    const { runWithContext } = await import("@/lib/auth/runtimeUserContext.js");

    await db.initDb();

    const orgA = await db.createOrganization({ slug: "acme", name: "Acme" });
    const orgB = await db.createOrganization({ slug: "beta", name: "Beta" });
    await db.createOrgSettings(orgA.id, { requireLogin: true, signupMode: "invite" });
    await db.createOrgSettings(orgB.id, { requireLogin: true, signupMode: "invite" });

    const userA = await db.createUser({ orgId: orgA.id, email: "a@acme.com", name: "A", password: "Password123", role: "admin" });
    const userB = await db.createUser({ orgId: orgB.id, email: "b@beta.com", name: "B", password: "Password123", role: "admin" });

    await runWithContext({ orgId: orgA.id, userId: userA.id }, async () => {
      await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "acme-openai", apiKey: "k-acme" });
      await db.createCombo({ name: "acme-combo", models: ["gpt-4"] });
      await db.createApiKey("acme-key", "m1", userA.id);
      await db.saveRequestUsage({ provider: "openai", model: "gpt-4", tokens: { prompt_tokens: 1 }, status: "ok" });
    });

    await runWithContext({ orgId: orgB.id, userId: userB.id }, async () => {
      await db.createProviderConnection({ provider: "openai", authType: "apikey", name: "beta-openai", apiKey: "k-beta" });
      await db.createCombo({ name: "beta-combo", models: ["gpt-4o-mini"] });
      await db.createApiKey("beta-key", "m1", userB.id);
      await db.saveRequestUsage({ provider: "openai", model: "gpt-4o-mini", tokens: { prompt_tokens: 1 }, status: "ok" });
    });

    const aConnections = await runWithContext({ orgId: orgA.id, userId: userA.id }, () => db.getProviderConnections());
    const bConnections = await runWithContext({ orgId: orgB.id, userId: userB.id }, () => db.getProviderConnections());
    expect(aConnections.map((c) => c.name)).toEqual(["acme-openai"]);
    expect(bConnections.map((c) => c.name)).toEqual(["beta-openai"]);

    const aCombos = await runWithContext({ orgId: orgA.id, userId: userA.id }, () => db.getCombos());
    const bCombos = await runWithContext({ orgId: orgB.id, userId: userB.id }, () => db.getCombos());
    expect(aCombos.map((c) => c.name)).toEqual(["acme-combo"]);
    expect(bCombos.map((c) => c.name)).toEqual(["beta-combo"]);

    const aKeys = await runWithContext({ orgId: orgA.id, userId: userA.id }, () => db.getApiKeys());
    const bKeys = await runWithContext({ orgId: orgB.id, userId: userB.id }, () => db.getApiKeys());
    expect(aKeys).toHaveLength(1);
    expect(bKeys).toHaveLength(1);
    expect(aKeys[0].name).toBe("acme-key");
    expect(bKeys[0].name).toBe("beta-key");

    const aHistory = await runWithContext({ orgId: orgA.id, userId: userA.id }, () => db.getUsageHistory({}));
    const bHistory = await runWithContext({ orgId: orgB.id, userId: userB.id }, () => db.getUsageHistory({}));
    expect(aHistory).toHaveLength(1);
    expect(bHistory).toHaveLength(1);
    expect(aHistory[0].model).toBe("gpt-4");
    expect(bHistory[0].model).toBe("gpt-4o-mini");
  }, 20000);
});

