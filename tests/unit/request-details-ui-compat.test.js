import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

function insertRow(row) {
  adapter.run(
    `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.timestamp, row.provider, row.model, row.connectionId, row.status, row.data]
  );
}

function insertPointerRow(row) {
  insertRow({
    id: row.id,
    timestamp: row.timestamp || new Date().toISOString(),
    provider: row.provider || "openai",
    model: row.model || "gpt-4",
    connectionId: row.connectionId || null,
    status: row.status || "success",
    data: JSON.stringify({ timslite_id: row.timslite_id }),
  });
}

function insertInlineRow(row) {
  insertRow({
    id: row.id,
    timestamp: row.timestamp || new Date().toISOString(),
    provider: row.provider || "openai",
    model: row.model || "gpt-4",
    connectionId: row.connectionId || null,
    status: row.status || "success",
    data: JSON.stringify({
      id: row.id,
      provider: row.provider || "openai",
      model: row.model || "gpt-4",
      timestamp: row.timestamp || new Date().toISOString(),
      status: row.status || "success",
      tokens: row.tokens || { prompt_tokens: 100, completion_tokens: 50 },
      latency: row.latency || { ttft: 10, total: 200 },
      request: row.request || { messages: [] },
      response: row.response || { content: "ok" },
    }),
  });
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-ui-compat-"));
  process.env.DATA_DIR = tempDir;
  delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  await db.updateSettings({ enableObservability: true, observabilityBatchSize: 1 });
  const { getAdapter } = await import("@/lib/db/driver.js");
  adapter = await getAdapter();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}
function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}
function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

describe("UI compatibility — unavailable record data shapes", () => {
  it("unavailable record has all required fields for table row rendering", async () => {
    adapter.run("DELETE FROM requestDetails");
    insertPointerRow({ id: "ui-1", provider: "openai", model: "gpt-4", timestamp: "2025-06-01T00:00:00Z", timslite_id: "111111111111" });

    const res = await db.getRequestDetails({ pageSize: 10 });
    const detail = res.details[0];

    expect(detail.id).toBe("ui-1");
    expect(detail.timestamp).toBe("2025-06-01T00:00:00Z");
    expect(detail.provider).toBe("openai");
    expect(detail.model).toBe("gpt-4");
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.tokens).toBeUndefined();
    expect(detail.latency).toBeUndefined();
  });

  it("token helpers never throw on unavailable record", () => {
    const unavailableRecord = {
      id: "ui-2",
      detailUnavailable: true,
      detailError: "Payload not found",
      timslite_id: "222222222222",
    };

    expect(() => getInputTokens(unavailableRecord.tokens)).not.toThrow();
    expect(() => getCachedTokens(unavailableRecord.tokens)).not.toThrow();
    expect(() => getCacheCreationTokens(unavailableRecord.tokens)).not.toThrow();
    expect(getInputTokens(unavailableRecord.tokens)).toBe(0);
    expect(getCachedTokens(unavailableRecord.tokens)).toBe(0);
    expect(getCacheCreationTokens(unavailableRecord.tokens)).toBe(0);
  });

  it("latency access never throws on unavailable record", () => {
    const unavailableRecord = {
      id: "ui-3",
      detailUnavailable: true,
    };

    expect(() => unavailableRecord.latency?.ttft || 0).not.toThrow();
    expect(() => unavailableRecord.latency?.total || 0).not.toThrow();
    expect(unavailableRecord.latency?.ttft || 0).toBe(0);
    expect(unavailableRecord.latency?.total || 0).toBe(0);
  });

  it("emdash rendering pattern works for unavailable tokens", () => {
    const tokens = undefined;
    const cachedDisplay = getCachedTokens(tokens) > 0 ? getCachedTokens(tokens).toLocaleString() : "\u2014";
    const cacheCreationDisplay = getCacheCreationTokens(tokens) > 0 ? getCacheCreationTokens(tokens).toLocaleString() : "\u2014";
    expect(cachedDisplay).toBe("\u2014");
    expect(cacheCreationDisplay).toBe("\u2014");
  });

  it("drawer fields safe for unavailable record — no JSON.stringify crash", () => {
    const unavailableRecord = {
      id: "ui-4",
      timestamp: "2025-06-01T00:00:00Z",
      provider: "openai",
      model: "gpt-4",
      status: "success",
      timslite_id: "444444444444",
      detailUnavailable: true,
      detailError: "Payload not found",
    };

    expect(() => JSON.stringify(unavailableRecord)).not.toThrow();
    expect(() => JSON.stringify(unavailableRecord.request, null, 2)).not.toThrow();
    expect(() => JSON.stringify(unavailableRecord.response, null, 2)).not.toThrow();
    expect(unavailableRecord.request).toBeUndefined();
    expect(unavailableRecord.response).toBeUndefined();
  });

  it("mixed page renders without throw when combined inline + unavailable", async () => {
    adapter.run("DELETE FROM requestDetails");
    insertInlineRow({ id: "ui-inline-1", provider: "openai", model: "gpt-4", timestamp: "2025-06-01T00:00:00Z" });
    insertPointerRow({ id: "ui-unavail-1", provider: "anthropic", model: "claude-3", timestamp: "2025-05-01T00:00:00Z", timslite_id: "555555555555" });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(2);

    for (const detail of res.details) {
      expect(() => {
        const tokens = detail.tokens;
        const cached = getCachedTokens(tokens);
        const cacheCreation = getCacheCreationTokens(tokens);
        const input = getInputTokens(tokens);
        const ttft = detail.latency?.ttft || 0;
        const total = detail.latency?.total || 0;
        const modelDisplay = detail.model || "";
        const providerDisplay = detail.provider || "";
        const timestampDisplay = new Date(detail.timestamp).toLocaleString();
        return { cached, cacheCreation, input, ttft, total, modelDisplay, providerDisplay, timestampDisplay };
      }).not.toThrow();
    }
  });
});
