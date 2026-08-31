// End-to-end smoke test for the Postgres storage layer — no Next.js required.
//
//   node --env-file=.env --import ./scripts/alias-hook-register.mjs scripts/pg-smoke.mjs
//
// Exercises: connection, migration/schema bootstrap, every repo's basic CRUD,
// transactions, kv scopes, usage aggregation, and full export/import.
import assert from "node:assert/strict";

const line = (s) => console.log(`\n\x1b[36m▶ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);

const db = await import("@/lib/db/index.js");
const { getAdapter } = await import("@/lib/db/driver.js");
const { closePool } = await import("@/lib/db/pg.js");

let failed = false;
try {
  line("connect + migrate");
  const adapter = await getAdapter();
  assert.equal(adapter.driver, "postgres");
  ok("adapter = postgres, migrations ran");

  line("settings (upsert inside tx)");
  await db.updateSettings({ smokeTest: true, rtkEnabled: false });
  const s = await db.getSettings();
  assert.equal(s.smokeTest, true);
  assert.equal(s.rtkEnabled, false);
  ok("updateSettings / getSettings round-trip");

  line("provider connections (tx + reorder)");
  const c1 = await db.createProviderConnection({ provider: "smoke", authType: "apikey", name: "k1", apiKey: "x" });
  const c2 = await db.createProviderConnection({ provider: "smoke", authType: "apikey", name: "k2", apiKey: "y" });
  assert.ok(c1.id && c2.id);
  const list = await db.getProviderConnections({ provider: "smoke" });
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((c) => c.priority).sort(), [1, 2]);
  const upd = await db.updateProviderConnection(c1.id, { accessToken: "tok", isActive: false });
  assert.equal(upd.accessToken, "tok");
  assert.equal(upd.isActive, false);
  const byId = await db.getProviderConnectionById(c1.id);
  assert.equal(byId.isActive, false);
  ok("create / list / update / getById");

  line("api keys");
  const k = await db.createApiKey("smoke-key", "machine-123");
  assert.ok(await db.validateApiKey(k.key));
  await db.updateApiKey(k.id, { isActive: false });
  assert.equal(await db.validateApiKey(k.key), false);
  ok("create / validate / deactivate");

  line("combos");
  const combo = await db.createCombo({ name: `smoke-${Date.now()}`, models: ["a/x", "b/y"] });
  const gotCombo = await db.getComboById(combo.id);
  assert.deepEqual(gotCombo.models, ["a/x", "b/y"]);
  await db.deleteCombo(combo.id);
  assert.equal(await db.getComboById(combo.id), null);
  ok("create / getById (JSON col) / delete");

  line("kv-backed repos: aliases, custom models, disabled, pricing");
  await db.setModelAlias("smoke-alias", "prov/model");
  assert.equal((await db.getModelAliases())["smoke-alias"], "prov/model");
  assert.equal(await db.addCustomModel({ providerAlias: "sp", id: "m1", name: "M1" }), true);
  assert.equal(await db.addCustomModel({ providerAlias: "sp", id: "m1", name: "M1" }), false); // dedup in tx
  await db.disableModels("smoke", ["m-a", "m-b"]);
  assert.deepEqual((await db.getDisabledByProvider("smoke")).sort(), ["m-a", "m-b"]);
  await db.enableModels("smoke", ["m-a"]);
  assert.deepEqual(await db.getDisabledByProvider("smoke"), ["m-b"]);
  await db.updatePricing({ smokeprov: { "model-z": { input: 1, output: 2 } } });
  const pr = await db.getPricingForModel("smokeprov", "model-z");
  assert.equal(pr.input, 1);
  ok("alias / custom-model dedup / disable+enable / pricing");

  line("usage: save + aggregate");
  await db.saveRequestUsage({
    provider: "smokeprov", model: "model-z", connectionId: c2.id, apiKey: k.key,
    endpoint: "/v1/chat/completions", status: "ok",
    tokens: { prompt_tokens: 10, completion_tokens: 5 },
  });
  const stats = await db.getUsageStats("today");
  assert.ok(stats.totalPromptTokens >= 10, `expected >=10 prompt tokens, got ${stats.totalPromptTokens}`);
  const chart = await db.getChartData("7d");
  assert.equal(chart.length, 7);
  const logs = await db.getRecentLogs(10);
  assert.ok(Array.isArray(logs));
  ok("saveRequestUsage / getUsageStats / getChartData / getRecentLogs");

  line("export / import full DB");
  const dump = await db.exportDb();
  assert.ok(dump.providerConnections.length >= 2);
  const reimported = await db.importDb(dump);
  assert.equal(reimported.providerConnections.length, dump.providerConnections.length);
  ok("exportDb / importDb round-trip");

  line("cleanup smoke rows");
  const adapter2 = await getAdapter();
  await adapter2.run("DELETE FROM providerConnections WHERE provider = ?", ["smoke"]);
  await adapter2.run("DELETE FROM apiKeys WHERE machineId = ?", ["machine-123"]);
  await adapter2.run("DELETE FROM kv WHERE scope = 'disabledModels' AND key = 'smoke'");
  await adapter2.run("DELETE FROM kv WHERE scope = 'pricing' AND key = 'smokeprov'");
  await adapter2.run("DELETE FROM kv WHERE scope = 'modelAliases' AND key = 'smoke-alias'");
  await adapter2.run("DELETE FROM kv WHERE scope = 'customModels' AND key LIKE 'sp|%'");
  await adapter2.run("DELETE FROM usageHistory WHERE provider = ?", ["smokeprov"]);
  await db.updateSettings({ smokeTest: null, rtkEnabled: true });
  ok("done");

  console.log("\n\x1b[42m\x1b[30m PASS \x1b[0m all smoke checks green\n");
} catch (err) {
  failed = true;
  console.error("\n\x1b[41m\x1b[30m FAIL \x1b[0m", err);
} finally {
  await closePool();
}
process.exit(failed ? 1 : 0);
