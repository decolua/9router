import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

function resetDbState() {
  // global._dbAdapter is the driver's state object ({ instance, initPromise }),
  // not the adapter — closing the instance is what releases the sqlite handle
  // and its beforeExit hook. Closing the wrapper was a no-op that leaked one
  // listener per test.
  const adapter = global._dbAdapter?.instance;
  if (adapter && typeof adapter.close === "function") {
    try { adapter.close(); } catch {}
  }
  if (global._statsEmitter && typeof global._statsEmitter.removeAllListeners === "function") {
    try { global._statsEmitter.removeAllListeners(); } catch {}
  }
  if (global._statsEmitTimers) {
    if (global._statsEmitTimers.update) clearTimeout(global._statsEmitTimers.update);
    if (global._statsEmitTimers.pending) clearTimeout(global._statsEmitTimers.pending);
  }
  delete global._dbAdapter;
  delete global._pendingRequests;
  delete global._lastErrorProvider;
  delete global._recentRing;
  delete global._statsEmitter;
  delete global._statsEmitTimers;
  delete global._pendingUsagePersists;
  vi.resetModules();
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-id-test-"));
  process.env.DATA_DIR = tempDir;
  resetDbState();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Usage Event Identity (F-01)", () => {
  it("a. 10 eventos, MESMO timestamp fixo relativo, tokens idênticos, sem ID → 10 rows, lifetime 10, usageDaily agregado x10", async () => {
    const relativeTs = new Date().toISOString();
    for (let i = 0; i < 10; i++) {
      await db.saveRequestUsage({
        provider: "openai",
        model: "gpt-4o",
        timestamp: relativeTs,
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }

    const history = await db.getUsageHistory();
    expect(history.length).toBe(10);
    expect(history[0].cost).toBeGreaterThanOrEqual(0);

    const stats24h = await db.getUsageStats("24h");
    expect(stats24h.totalRequests).toBe(10);
    expect(stats24h.byProvider.openai.requests).toBe(10);
    expect(stats24h.byProvider.openai.promptTokens).toBe(100);
    expect(stats24h.byProvider.openai.completionTokens).toBe(50);

    const stats7d = await db.getUsageStats("7d");
    expect(stats7d.totalRequests).toBe(10);
  });

  it("b. Reenvio do MESMO evento com usageEventId: 'evt-x' duas vezes → 1 row, endpoint enriquecido, sem duplo incremento, conflito detectado", async () => {
    const relativeTs = new Date().toISOString();
    const eventId = "evt-x";
    const updatePromise = new Promise((resolve) => {
      const listener = () => {
        db.statsEmitter.off("update", listener);
        resolve(true);
      };
      db.statsEmitter.on("update", listener);
    });

    await db.saveRequestUsage({
      usageEventId: eventId,
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      endpoint: null,
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    await db.saveRequestUsage({
      usageEventId: eventId,
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      endpoint: "/v1/chat/completions",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const history = await db.getUsageHistory();
    expect(history.length).toBe(1);
    expect(history[0].usageEventId).toBe("evt-x");
    expect(history[0].endpoint).toBe("/v1/chat/completions");
    expect(history[0].cost).toBeGreaterThanOrEqual(0);

    const stats = await db.getUsageStats("24h");
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalPromptTokens).toBe(100);

    // Lifetime assertion in _meta table
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const lifetimeRow = adapter.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'");
    expect(lifetimeRow.value).toBe("1");

    // Conflict detection assertion: payload conflict on same ID
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await db.saveRequestUsage({
      usageEventId: eventId,
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      endpoint: "/v1/chat/completions",
      tokens: { prompt_tokens: 999, completion_tokens: 999 },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("usageEventId evt-x payload conflict")
    );
    warnSpy.mockRestore();

    // History and counters unchanged after conflict
    const historyAfterConflict = await db.getUsageHistory();
    expect(historyAfterConflict.length).toBe(1);
    const statsAfterConflict = await db.getUsageStats("24h");
    expect(statsAfterConflict.totalPromptTokens).toBe(100);

    const emitted = await Promise.race([
      updatePromise,
      new Promise((resolve) => setTimeout(() => resolve(false), 500)),
    ]);
    expect(emitted).toBe(true);
  });
  it("b2. Enriquecimento de endpoint altera APENAS a contagem do evento individual, preservando outros eventos Unknown", async () => {
    const relativeTs = new Date().toISOString();

    await db.saveRequestUsage({
      usageEventId: "evt-unk-1",
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      endpoint: null,
      tokens: { prompt_tokens: 50, completion_tokens: 10 },
    });

    await db.saveRequestUsage({
      usageEventId: "evt-unk-2",
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      endpoint: null,
      tokens: { prompt_tokens: 30, completion_tokens: 5 },
    });

    const statsBefore = await db.getUsageStats("24h");
    expect(statsBefore.byEndpoint["Unknown|gpt-4o|openai"].requests).toBe(2);
    expect(statsBefore.byEndpoint["Unknown|gpt-4o|openai"].promptTokens).toBe(80);

    await db.saveRequestUsage({
      usageEventId: "evt-unk-1",
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      endpoint: "/v1/chat/completions",
      tokens: { prompt_tokens: 50, completion_tokens: 10 },
    });

    const statsAfter = await db.getUsageStats("24h");
    expect(statsAfter.byEndpoint["Unknown|gpt-4o|openai"].requests).toBe(1);
    expect(statsAfter.byEndpoint["Unknown|gpt-4o|openai"].promptTokens).toBe(30);
    expect(statsAfter.byEndpoint["/v1/chat/completions|gpt-4o|openai"].requests).toBe(1);
    expect(statsAfter.byEndpoint["/v1/chat/completions|gpt-4o|openai"].promptTokens).toBe(50);
  });
  it("b3. Conflito detectado para discrepâncias em cache_creation_input_tokens, reasoning_tokens, connectionId ou provider", async () => {
    const relativeTs = new Date().toISOString();

    await db.saveRequestUsage({
      usageEventId: "evt-strict-1",
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-a",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 100, completion_tokens: 50, cache_creation_input_tokens: 20, reasoning_tokens: 10 },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Discrepancy in cache_creation_input_tokens
    await db.saveRequestUsage({
      usageEventId: "evt-strict-1",
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-a",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 100, completion_tokens: 50, cache_creation_input_tokens: 99, reasoning_tokens: 10 },
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("usageEventId evt-strict-1 payload conflict"));

    // Discrepancy in reasoning_tokens
    await db.saveRequestUsage({
      usageEventId: "evt-strict-1",
      provider: "openai",
      model: "gpt-4o",
      connectionId: "conn-a",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 100, completion_tokens: 50, cache_creation_input_tokens: 20, reasoning_tokens: 99 },
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("usageEventId evt-strict-1 payload conflict"));

    // Discrepancy in connectionId (null vs conn-a)
    await db.saveRequestUsage({
      usageEventId: "evt-strict-1",
      provider: "openai",
      model: "gpt-4o",
      connectionId: null,
      timestamp: relativeTs,
      tokens: { prompt_tokens: 100, completion_tokens: 50, cache_creation_input_tokens: 20, reasoning_tokens: 10 },
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("usageEventId evt-strict-1 payload conflict"));

    warnSpy.mockRestore();

    const history = await db.getUsageHistory();
    expect(history.length).toBe(1);
  });

  it("c. Duas tentativas no mesmo ms, tokens idênticos, IDs distintos ('evt-r1' / 'evt-r2') → 2 rows", async () => {
    const relativeTs = new Date().toISOString();

    await db.saveRequestUsage({
      usageEventId: "evt-r1",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
    });

    await db.saveRequestUsage({
      usageEventId: "evt-r2",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 20, completion_tokens: 10 },
    });

    const history = await db.getUsageHistory();
    expect(history.length).toBe(2);

    const stats = await db.getUsageStats("24h");
    expect(stats.totalRequests).toBe(2);
  });

  it("d. Evento com ID 'evt-y' + evento sem ID com payload idêntico no mesmo ms → 2 rows", async () => {
    const relativeTs = new Date().toISOString();

    await db.saveRequestUsage({
      usageEventId: "evt-y",
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 15, completion_tokens: 5 },
    });

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      timestamp: relativeTs,
      tokens: { prompt_tokens: 15, completion_tokens: 5 },
    });

    const history = await db.getUsageHistory();
    expect(history.length).toBe(2);
  });

  it("e. Concorrência: 100 saveRequestUsage paralelos com IDs distintos → 100 rows; 50 paralelos idênticos sem ID → 50 rows", async () => {
    const relativeTs = new Date().toISOString();

    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        db.saveRequestUsage({
          usageEventId: `evt-par-${i}`,
          provider: "openai",
          model: "gpt-4o",
          timestamp: relativeTs,
          tokens: { prompt_tokens: 10, completion_tokens: 2 },
        })
      )
    );

    let history = await db.getUsageHistory();
    expect(history.length).toBe(100);

    await Promise.all(
      Array.from({ length: 50 }, () =>
        db.saveRequestUsage({
          provider: "openai",
          model: "gpt-4o",
          timestamp: relativeTs,
          tokens: { prompt_tokens: 10, completion_tokens: 2 },
        })
      )
    );

    history = await db.getUsageHistory();
    expect(history.length).toBe(150);
  });


  it("f. Migração: banco novo, versionado v1, legado sem versão e re-execução idempotente", async () => {
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();

    // 1. Banco novo tem coluna e índice
    const cols = adapter.all("PRAGMA table_info(usageHistory)");
    expect(cols.some((c) => c.name === "usageEventId")).toBe(true);

    const indexes = adapter.all("PRAGMA index_list(usageHistory)");
    expect(indexes.some((idx) => idx.name === "idx_uh_event")).toBe(true);

    // 2. Re-execução idempotente da migration 002
    const m002 = (await import("@/lib/db/migrations/002-usage-event-id.js")).default;
    expect(() => m002.up(adapter)).not.toThrow();

    // 3. Teste banco versionado v1 (migração v1 -> v2 preservando dados)
    const v1Dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-v1-test-"));
    try {
      process.env.DATA_DIR = v1Dir;
      resetDbState();
      const driver = await import("@/lib/db/driver.js");
      const v1Adapter = await driver.getAdapter();

      // Executar migração versionada
      const { runMigrationOnce } = await import("@/lib/db/migrate.js");
      await runMigrationOnce(v1Adapter);

      const v1Cols = v1Adapter.all("PRAGMA table_info(usageHistory)");
      expect(v1Cols.some((c) => c.name === "usageEventId")).toBe(true);
    } finally {
      fs.rmSync(v1Dir, { recursive: true, force: true });
    }
  });

  it("f2. banco existente (versionado v1 e legado sem versão) migra sem lançar, preserva a row e aceita novos eventos", async () => {
    for (const scenario of ["versioned-v1", "legacy-no-version"]) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-mig-${scenario}-`));
      try {
        // DB no formato pré-F-01: usageHistory sem a coluna usageEventId + 1 row antiga.
        const { DatabaseSync } = await import("node:sqlite");
        fs.mkdirSync(path.join(dir, "db"), { recursive: true });
        const raw = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
        raw.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        raw.exec(`CREATE TABLE usageHistory (
          id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, provider TEXT, model TEXT,
          connectionId TEXT, apiKey TEXT, endpoint TEXT, promptTokens INTEGER DEFAULT 0,
          completionTokens INTEGER DEFAULT 0, cost REAL DEFAULT 0, status TEXT, tokens TEXT, meta TEXT)`);
        raw.exec(`INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status)
                  VALUES('2026-01-01T00:00:00.000Z', 'openai', 'gpt-4o', 100, 50, 0.1, 'ok')`);
        if (scenario === "versioned-v1") {
          raw.exec(`INSERT INTO _meta(key, value) VALUES('schemaVersion', '1')`);
        }
        raw.close();

        process.env.DATA_DIR = dir;
        resetDbState();
        const driver = await import("@/lib/db/driver.js");
        // init do adapter roda runMigrationOnce → aqui o caminho legado quebrava (índice antes da coluna)
        const adapter = await driver.getAdapter();

        const cols = adapter.all("PRAGMA table_info(usageHistory)");
        expect(cols.some((c) => c.name === "usageEventId"), `${scenario}: coluna usageEventId`).toBe(true);
        const indexes = adapter.all("PRAGMA index_list(usageHistory)");
        expect(indexes.some((i) => i.name === "idx_uh_event"), `${scenario}: índice idx_uh_event`).toBe(true);

        const preserved = adapter.all(`SELECT provider, promptTokens FROM usageHistory`);
        expect(preserved.length, `${scenario}: row antiga preservada`).toBe(1);
        expect(preserved[0].provider).toBe("openai");
        expect(preserved[0].promptTokens).toBe(100);

        const dbMod = await import("@/lib/db/index.js");
        await dbMod.saveRequestUsage({
          usageEventId: `evt-${scenario}`,
          provider: "openai",
          model: "gpt-4o",
          tokens: { prompt_tokens: 1, completion_tokens: 1 },
        });
        const after = adapter.all(`SELECT COUNT(*) as c FROM usageHistory`);
        expect(after[0].c, `${scenario}: insert pós-migração`).toBe(2);

        adapter.close();
      } finally {
        process.env.DATA_DIR = tempDir;
        resetDbState();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  // ── Adapter coverage (plano §1: "testar adaptadores disponíveis e explicitar
  // os não exercitados") ────────────────────────────────────────────────────
  // driver.js binds ONE adapter per process, so every test above runs on that
  // one. These two exercise the F-01 storage contract — the partial unique
  // index that makes a repeated usageEventId a no-op — on every adapter that
  // can actually load here, and pin down which ones cannot and why.
  const ADAPTERS = (() => {
    const [maj, min] = process.versions.node.split(".").map(Number);
    const onBun = !!process.versions.bun;
    // Static import() per adapter: a templated specifier makes the bundler warn
    // and cannot be analysed.
    return [
      { name: "bun:sqlite", file: "bunSqliteAdapter.js", factory: "createBunSqliteAdapter",
        load: () => import("@/lib/db/adapters/bunSqliteAdapter.js"),
        available: onBun, reason: "requires the Bun runtime" },
      { name: "better-sqlite3", file: "betterSqliteAdapter.js", factory: "createBetterSqliteAdapter",
        load: () => import("@/lib/db/adapters/betterSqliteAdapter.js"),
        available: !onBun && maj < 24,
        reason: `driver.js skips the native addon on Node >= 24 (it SIGSEGVs on load); running Node ${process.versions.node}` },
      { name: "node:sqlite", file: "nodeSqliteAdapter.js", factory: "createNodeSqliteAdapter",
        load: () => import("@/lib/db/adapters/nodeSqliteAdapter.js"),
        available: !onBun && (maj > 22 || (maj === 22 && min >= 5)), reason: "requires Node >= 22.5" },
      { name: "sql.js", file: "sqljsAdapter.js", factory: "createSqlJsAdapter",
        load: () => import("@/lib/db/adapters/sqljsAdapter.js"),
        available: true, reason: "pure-JS fallback, always loadable" },
    ];
  })();

  it("h. every shipped adapter is either exercised below or has a stated reason", () => {
    const shipped = fs.readdirSync(path.join(process.cwd(), "src/lib/db/adapters")).filter((f) => f.endsWith(".js"));
    const mapped = ADAPTERS.map((a) => a.file).sort();
    expect(mapped, "a new adapter must be added to ADAPTERS, exercised or excused").toEqual(shipped.sort());

    const exercised = ADAPTERS.filter((a) => a.available).map((a) => a.name);
    const skipped = ADAPTERS.filter((a) => !a.available).map((a) => `${a.name} (${a.reason})`);
    console.log(`[F-01] adapters exercised: ${exercised.join(", ") || "none"}`);
    console.log(`[F-01] adapters NOT exercised: ${skipped.join("; ") || "none"}`);
    expect(exercised.length, "at least one adapter must be exercised").toBeGreaterThan(0);
  });

  it("i. usageEventId identity holds on every adapter available in this environment", async () => {
    const { runMigrationOnce } = await import("@/lib/db/migrate.js");
    const row = (id) =>
      `INSERT INTO usageHistory(usageEventId, timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(${id === null ? "NULL" : `'${id}'`}, '2026-09-16T12:00:00.000Z', 'openai', 'gpt-4o', 10, 5, 0, 'ok', '{}', '{}')`;

    for (const spec of ADAPTERS.filter((a) => a.available)) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-adapter-${spec.name.replace(/[:.]/g, "-")}-`));
      const prevDataDir = process.env.DATA_DIR;
      process.env.DATA_DIR = dir;
      let adapter;
      try {
        const mod = await spec.load();
        adapter = await mod[spec.factory](path.join(dir, "data.sqlite"));
        await runMigrationOnce(adapter);

        const cols = adapter.all("PRAGMA table_info(usageHistory)");
        expect(cols.some((c) => c.name === "usageEventId"), `${spec.name}: coluna`).toBe(true);
        const indexes = adapter.all("PRAGMA index_list(usageHistory)");
        expect(indexes.some((i) => i.name === "idx_uh_event"), `${spec.name}: índice`).toBe(true);

        adapter.run(row("evt-a"));
        adapter.run(row("evt-b"));
        // Same id twice must be rejected by the storage layer itself — that is
        // what makes saveRequestUsage's idempotence more than a read-then-write.
        expect(() => adapter.run(row("evt-a")), `${spec.name}: id duplicado`).toThrow(/unique|constraint/i);
        // …while id-less events stay independent (partial index).
        adapter.run(row(null));
        adapter.run(row(null));

        const count = adapter.all("SELECT COUNT(*) AS c FROM usageHistory");
        expect(Number(count[0].c), `${spec.name}: 2 com id + 2 sem id`).toBe(4);
      } finally {
        try { adapter?.close?.(); } catch {}
        if (prevDataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = prevDataDir;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 20000);

  it("g. recentRequests de getUsageStats / getActiveRequests sem colapso por minuto", async () => {
    const now = Date.now();
    const ts1 = new Date(now - 2000).toISOString();
    const ts2 = new Date(now - 1000).toISOString();

    await db.saveRequestUsage({
      provider: "google",
      model: "gemini-1.5-pro",
      timestamp: ts1,
      tokens: { prompt_tokens: 50, completion_tokens: 20 },
    });

    await db.saveRequestUsage({
      provider: "google",
      model: "gemini-1.5-pro",
      timestamp: ts2,
      tokens: { prompt_tokens: 50, completion_tokens: 20 },
    });

    const active = await db.getActiveRequests();
    expect(active.recentRequests.length).toBe(2);

    const stats = await db.getUsageStats("24h");
    expect(stats.recentRequests.length).toBe(2);
  });
});
