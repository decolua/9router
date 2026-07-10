import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import Database from "better-sqlite3";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { getUsageForProvider } from "../../open-sse/services/usage.js";

function makeTempDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-xai-test-"));
  const dbDir = path.join(tmpDir, "db");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "data.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE usageHistory (
      id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      connectionId TEXT,
      apiKey TEXT,
      endpoint TEXT,
      promptTokens INTEGER DEFAULT 0,
      completionTokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      status TEXT,
      tokens TEXT,
      meta TEXT
    );
  `);
  return { dbPath, tmpDir };
}

function seedHistory(dbPath, rows) {
  const db = new Database(dbPath);
  const insert = db.prepare(
    `INSERT INTO usageHistory
       (timestamp, provider, model, connectionId, promptTokens, completionTokens, cost, status)
     VALUES (?, 'xai', ?, ?, ?, ?, ?, 'success')`,
  );
  for (const r of rows) {
    insert.run(r.timestamp, r.model, r.connectionId, r.prompt, r.completion, r.cost);
  }
  db.close();
}

describe("xAI (Grok) usage", () => {
  let dbPath;
  let tmpDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    const t = makeTempDb();
    dbPath = t.dbPath;
    tmpDir = t.tmpDir;
    process.env.DATA_DIR = tmpDir;
  });

  it("aggregates tokens and cost per model from usageHistory", async () => {
    const now = Date.now();
    seedHistory(dbPath, [
      { timestamp: new Date(now - 1000).toISOString(), model: "grok-4", connectionId: "conn-1", prompt: 100, completion: 50, cost: 0.0006 },
      { timestamp: new Date(now - 2000).toISOString(), model: "grok-4", connectionId: "conn-1", prompt: 200, completion: 75, cost: 0.0009 },
      { timestamp: new Date(now - 3000).toISOString(), model: "grok-code-fast-1", connectionId: "conn-1", prompt: 400, completion: 25, cost: 0.0005 },
    ]);

    const result = await getUsageForProvider({ provider: "xai", id: "conn-1" });

    expect(result.plan).toBe("xAI / Grok Build");
    expect(result.quotas).toBeDefined();
    expect(result.quotas["Total tokens (30d)"].used).toBe(850);
    expect(result.quotas["Total spend (30d)"].used).toBeCloseTo(0.002, 4);
    expect(result.quotas["grok-4 (30d)"].used).toBe(425);
    expect(result.quotas["grok-code-fast-1 (30d)"].used).toBe(425);
  });

  it("returns graceful message when no xai history exists", async () => {
    const result = await getUsageForProvider({ provider: "xai", id: "conn-1" });
    expect(result.message).toMatch(/No requests recorded/);
    expect(result.quotas).toEqual({});
  });

  it("scopes aggregation to the requested connectionId", async () => {
    const now = Date.now();
    seedHistory(dbPath, [
      { timestamp: new Date(now - 1000).toISOString(), model: "grok-4", connectionId: "conn-A", prompt: 100, completion: 0, cost: 0.0001 },
      { timestamp: new Date(now - 1000).toISOString(), model: "grok-4", connectionId: "conn-B", prompt: 999, completion: 999, cost: 0.5 },
    ]);

    const resultA = await getUsageForProvider({ provider: "xai", id: "conn-A" });
    expect(resultA.quotas["Total tokens (30d)"].used).toBe(100);
    expect(resultA.quotas["Total spend (30d)"].used).toBeCloseTo(0.0001, 4);
  });
});
