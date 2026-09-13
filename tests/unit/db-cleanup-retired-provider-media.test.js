// Verify migration 009 removes persisted data for retired providers
// (Qoder under both "qoder" and its model alias "qd", direct NVIDIA NIM) and
// standalone media records while preserving LLM connections, combos, aliases,
// custom models, usage history — and nvidia model ids under third-party
// provider catalogs (kilo-gateway "kgw/nvidia/...").

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-retired-cleanup-"));
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

async function openDb() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const conn = (id, provider) =>
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, provider, "apikey", id, null, 1, 1, "{}", now, now],
    );

  conn("q1", "qoder");
  conn("n1", "nvidia");
  conn("o1", "openai");

  db.run(`INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["pne1", "custom-embedding", "EmbedNode", "{}", now, now]);
  db.run(`INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["pnl1", "openai-compatible", "LLMNode", "{}", now, now]);

  for (const kind of ["embedding", "image", "tts", "stt", "webSearch", "webFetch", "video", "music"]) {
    db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, [`cmb-${kind}`, `${kind}-combo`, kind, "[]", now, now]);
  }
  db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["cmb-llm", "llm-combo", "llm", JSON.stringify(["openai/gpt-4o", "qd/auto"]), now, now]);
  db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["cmb-qd-only", "qd-only-combo", null, JSON.stringify(["qd/auto"]), now, now]);
  db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["cmb-null", "null-combo", null, JSON.stringify(["openai/gpt-4o"]), now, now]);
  db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, ["cmb-kgw", "kgw-combo", null, JSON.stringify(["kgw/nvidia/nemotron-strauss"]), now, now]);

  const kv = (scope, key, value) => db.run(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)`, [scope, key, value]);
  // alias direction A: key=alias, value=modelString (PUT /api/models/alias)
  kv("modelAliases", "alg1", JSON.stringify("qoder/qmodel"));
  kv("modelAliases", "alg2", JSON.stringify("qd/auto"));
  kv("modelAliases", "alg3", JSON.stringify("openai/gpt-4o"));
  // alias direction B: key=modelString, value=alias (PUT /api/models)
  kv("modelAliases", "nvidia/nim", JSON.stringify("nim-alias"));
  kv("modelAliases", "openai/gpt-4o-mini", JSON.stringify("mini-alias"));
  // customModels
  kv("customModels", "qoder|q-custom|llm", JSON.stringify({ providerAlias: "qoder", id: "q-custom", type: "llm" }));
  kv("customModels", "qd|qd-custom|llm", JSON.stringify({ providerAlias: "qd", id: "qd-custom", type: "llm" }));
  kv("customModels", "nvidia|nim-emb|embedding", JSON.stringify({ providerAlias: "nvidia", id: "nim-emb", type: "embedding" }));
  kv("customModels", "openai|custom-tts|tts", JSON.stringify({ providerAlias: "openai", id: "custom-tts", type: "tts" }));
  kv("customModels", "openai|custom-llm|llm", JSON.stringify({ providerAlias: "openai", id: "custom-llm", type: "llm" }));
  // disabledModels + pricing
  kv("disabledModels", "qoder", JSON.stringify(["qmodel"]));
  kv("disabledModels", "qd", JSON.stringify(["auto"]));
  kv("disabledModels", "nvidia", JSON.stringify(["nim"]));
  kv("disabledModels", "openai", JSON.stringify(["gpt-4"]));
  kv("pricing", "qoder", JSON.stringify({ qmodel: {} }));
  kv("pricing", "qd", JSON.stringify({ auto: {} }));
  kv("pricing", "nvidia", JSON.stringify({ nim: {} }));
  kv("pricing", "openai", JSON.stringify({ "gpt-4o": {} }));

  return db;
}

const SETTINGS = JSON.stringify({
  providerStrategies: { qoder: { fallback: true }, qd: { fallback: true }, nvidia: { fallback: true }, openai: { fallback: true } },
  quotaVisibility: { qd: { show: true }, nvidia: { show: true }, openai: { show: true } },
  comboStrategies: { "embedding-combo": { fallbackStrategy: "round-robin" }, "llm-combo": { fallbackStrategy: "fallback" } },
  cloudEnabled: true,
});

function reopen() {
  delete global._dbAdapter;
  vi.resetModules();
  return import("@/lib/db/driver.js").then(({ getAdapter }) => getAdapter());
}

describe("migration 009 — cleanup retired provider + media data", () => {
  it("version 9 is registered and is the latest version", async () => {
    const { MIGRATIONS, latestVersion } = await import("@/lib/db/migrations/index.js");
    const m9 = MIGRATIONS.find((m) => m.version === 9);
    expect(m9).toBeDefined();
    expect(m9.name).toBe("cleanup-retired-provider-media-data");
    expect(latestVersion()).toBe(9);
  });

  it("removes retired connections, media nodes/combos/models while preserving LLM rows and usage", async () => {
    const db = await openDb();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [SETTINGS]);
    const ts = nowTs();
    db.run(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ts, "qoder", "qmodel", "q1", null, "/v1/chat/completions", 1, 1, 0, "ok", "{}", "{}"]);
    db.run(`INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ts, "openai", "gpt-4o", "o1", null, "/v1/chat/completions", 2, 2, 0, "ok", "{}", "{}"]);

    db.run(`UPDATE _meta SET value = '1' WHERE key = 'schemaVersion'`);
    db.close?.();

    const db2 = await reopen();

    // Connections: both retired ids gone, LLM preserved.
    const providers = db2.all(`SELECT provider FROM providerConnections`).map((r) => r.provider);
    expect(providers).toEqual(["openai"]);

    // Nodes: custom-embedding removed, openai-compatible preserved.
    const nodeTypes = db2.all(`SELECT type FROM providerNodes`).map((r) => r.type);
    expect(nodeTypes).toEqual(["openai-compatible"]);

    // Combos: media kinds gone; retired members stripped; empty combos gone;
    // kilo-gateway nvidia model id preserved.
    const combos = db2.all(`SELECT name, kind, models FROM combos`);
    expect(combos.filter((c) => c.kind && c.kind !== "llm")).toHaveLength(0);
    const byName = Object.fromEntries(combos.map((c) => [c.name, c]));
    expect(byName["llm-combo"].kind).toBe("llm");
    expect(JSON.parse(byName["llm-combo"].models)).toEqual(["openai/gpt-4o"]);
    expect(byName["qd-only-combo"]).toBeUndefined();
    expect(JSON.parse(byName["null-combo"].models)).toEqual(["openai/gpt-4o"]);
    expect(JSON.parse(byName["kgw-combo"].models)).toEqual(["kgw/nvidia/nemotron-strauss"]);

    // Aliases: retired targets dropped in BOTH persisted directions.
    const aliasEntries = db2.all(`SELECT key, value FROM kv WHERE scope='modelAliases'`).map((r) => [r.key, JSON.parse(r.value)]);
    expect(aliasEntries).toEqual(expect.arrayContaining([
      ["alg3", "openai/gpt-4o"],
      ["openai/gpt-4o-mini", "mini-alias"],
    ]));
    expect(aliasEntries).toHaveLength(2);

    // Custom models: retired providers and media types dropped.
    const customKeys = db2.all(`SELECT key FROM kv WHERE scope='customModels'`).map((r) => r.key);
    expect(customKeys).toEqual(["openai|custom-llm|llm"]);

    // Disabled models + pricing: retired provider keys dropped.
    const disabledKeys = db2.all(`SELECT key FROM kv WHERE scope='disabledModels'`).map((r) => r.key);
    expect(disabledKeys).toEqual(["openai"]);
    const pricingKeys = db2.all(`SELECT key FROM kv WHERE scope='pricing'`).map((r) => r.key);
    expect(pricingKeys).toEqual(["openai"]);

    // Settings: all retired-provider sections stripped; rest intact.
    const settings = JSON.parse(db2.get(`SELECT data FROM settings WHERE id=1`).data);
    expect(settings.providerStrategies).toEqual({ openai: { fallback: true } });
    expect(settings.quotaVisibility).toEqual({ openai: { show: true } });
    expect(settings.comboStrategies["embedding-combo"]).toEqual({ fallbackStrategy: "round-robin" });
    expect(settings.cloudEnabled).toBe(true);

    // Usage history preserved, including retired-provider rows.
    const hist = db2.all(`SELECT provider FROM usageHistory`).map((r) => r.provider);
    expect(hist).toEqual(expect.arrayContaining(["qoder", "openai"]));

    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    expect(parseInt(db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`).value, 10)).toBe(latestVersion());
  });

  it("idempotent when re-booted after the migration ran", async () => {
    const db = await openDb();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [SETTINGS]);
    db.run(`UPDATE _meta SET value = '1' WHERE key = 'schemaVersion'`);
    db.close?.();

    const db2 = await reopen();
    const combos = db2.all(`SELECT kind FROM combos`);
    expect(combos.filter((r) => r.kind && r.kind !== "llm")).toHaveLength(0);
    expect(db2.all(`SELECT provider FROM providerConnections`).map((r) => r.provider)).toEqual(["openai"]);
  });

  it("importDb filters retired providers and media records from an old export", async () => {
    const db = await openDb();
    // Simulate post-migration state: retired rows are already gone.
    db.run(`DELETE FROM kv WHERE scope='disabledModels' AND key IN ('qoder','qd','nvidia')`);
    const dbIndex = await import("@/lib/db/index.js");
    const now = new Date().toISOString();

    const result = await dbIndex.importDb({
      settings: {
        providerStrategies: { qoder: { fallback: true }, qd: { fallback: true }, openai: { fallback: true } },
        quotaVisibility: { nvidia: { show: true } },
        cloudEnabled: true,
      },
      providerConnections: [
        { id: "q1", provider: "qoder", authType: "oauth", createdAt: now, updatedAt: now },
        { id: "q2", provider: "qd", authType: "oauth", createdAt: now, updatedAt: now },
        { id: "n1", provider: "nvidia", authType: "apikey", createdAt: now, updatedAt: now },
        { id: "o1", provider: "openai", authType: "apikey", createdAt: now, updatedAt: now },
      ],
      providerNodes: [
        { id: "pn1", type: "custom-embedding", createdAt: now, updatedAt: now },
        { id: "pn2", type: "openai-compatible", createdAt: now, updatedAt: now },
      ],
      combos: [
        { id: "c1", name: "emb-combo", kind: "embedding", models: [], createdAt: now, updatedAt: now },
        { id: "c2", name: "llm-combo", kind: "llm", models: ["qd/auto", "openai/gpt-4o"], createdAt: now, updatedAt: now },
        { id: "c3", name: "qd-only", kind: null, models: ["qd/auto"], createdAt: now, updatedAt: now },
        { id: "c4", name: "plain-combo", kind: null, models: ["openai/gpt-4o"], createdAt: now, updatedAt: now },
      ],
      modelAliases: { a1: "qoder/qmodel", "qd/auto": "auto-alias", a3: "openai/gpt-4o" },
      customModels: [
        { providerAlias: "qd", id: "q1", type: "llm" },
        { providerAlias: "openai", id: "t1", type: "tts" },
        { providerAlias: "openai", id: "l1", type: "llm" },
      ],
      pricing: { qd: { auto: {} }, openai: { "gpt-4o": {} } },
      disabled: { nvidia: ["nim"], openai: ["gpt-4"] },
    });

    expect(result.providerConnections.map((c) => c.provider)).toEqual(["openai"]);
    expect(result.providerNodes.map((n) => n.type)).toEqual(["openai-compatible"]);
    const comboByName = Object.fromEntries(result.combos.map((c) => [c.name, c]));
    expect(comboByName["emb-combo"]).toBeUndefined();
    expect(comboByName["qd-only"]).toBeUndefined();
    expect(comboByName["llm-combo"].models).toEqual(["openai/gpt-4o"]);
    expect(Object.keys(result.modelAliases)).toEqual(["a3"]);
    expect(result.customModels.map((m) => `${m.providerAlias}|${m.id}|${m.type}`)).toEqual(["openai|l1|llm"]);
    expect(Object.keys(result.pricing)).toEqual(["openai"]);
    expect(result.settings.providerStrategies).toEqual({ openai: { fallback: true } });
    expect(result.settings.quotaVisibility).toEqual({});
    expect(result.settings.cloudEnabled).toBe(true);

    // `disabled` is not part of the export/import round-trip (importDb neither
    // wipes nor writes that kv scope) — so the payload's nvidia entry must not
    // have been written back into the post-migration state.
    const disabledKeys = db.all(`SELECT key FROM kv WHERE scope='disabledModels'`).map((r) => r.key);
    expect(disabledKeys).toEqual(["openai"]);
  });

  it("legacy db.json import filters retired rows via the shared sanitizer", async () => {
    const legacy = {
      settings: { providerStrategies: { qd: { fallback: true }, openai: {} } },
      providerConnections: [
        { id: "q1", provider: "qoder", authType: "oauth" },
        { id: "o1", provider: "openai", authType: "apikey" },
      ],
      providerNodes: [{ id: "pn1", type: "custom-embedding" }, { id: "pn2", type: "openai-compatible" }],
      combos: [
        { id: "c1", name: "tts-combo", kind: "tts", models: [] },
        { id: "c2", name: "llm-combo", kind: "llm", models: ["qoder/qmodel", "openai/gpt-4o"] },
      ],
      modelAliases: { a1: "qoder/qmodel", "qd/auto": "qd-auto", a2: "openai/gpt-4o" },
      customModels: [
        { providerAlias: "nvidia", id: "emb1", type: "embedding" },
        { providerAlias: "qd", id: "q1", type: "llm" },
        { providerAlias: "openai", id: "l1", type: "llm" },
      ],
      pricing: { nvidia: { nim: {} }, qoder: {} },
    };
    fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(legacy));
    // Disabled models and usage history live in their own legacy files.
    fs.writeFileSync(path.join(tempDir, "disabledModels.json"), JSON.stringify({
      disabled: { qoder: ["qmodel"], nvidia: ["nim"], openai: ["gpt-4"] },
    }));
    fs.writeFileSync(path.join(tempDir, "usage.json"), JSON.stringify({
      history: [{ timestamp: nowTs(), provider: "qoder", model: "qmodel", tokens: { prompt_tokens: 1, completion_tokens: 1 }, status: "ok" }],
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(db.all(`SELECT provider FROM providerConnections`).map((r) => r.provider)).toEqual(["openai"]);
    expect(db.all(`SELECT type FROM providerNodes`).map((r) => r.type)).toEqual(["openai-compatible"]);
    const llmCombo = db.get(`SELECT models FROM combos WHERE name='llm-combo'`);
    expect(JSON.parse(llmCombo.models)).toEqual(["openai/gpt-4o"]);
    expect(db.all(`SELECT key FROM kv WHERE scope='modelAliases'`).map((r) => r.key)).toEqual(["a2"]);
    expect(db.all(`SELECT value FROM kv WHERE scope='customModels'`).map((r) => JSON.parse(r.value).id)).toEqual(["l1"]);
    expect(db.get(`SELECT value FROM kv WHERE scope='pricing' AND key='nvidia'`)).toBeUndefined();
    expect(db.get(`SELECT value FROM kv WHERE scope='disabledModels' AND key='qoder'`)).toBeUndefined();
    expect(db.get(`SELECT value FROM kv WHERE scope='disabledModels' AND key='openai'`)).not.toBeUndefined();
    const settings = JSON.parse(db.get(`SELECT data FROM settings WHERE id=1`).data);
    expect(settings.providerStrategies).toEqual({ openai: {} });
    // Historical usage from the legacy file is preserved as-is.
    expect(db.all(`SELECT provider FROM usageHistory`).map((r) => r.provider)).toContain("qoder");
  });
});

function nowTs() {
  return new Date().toISOString();
}
