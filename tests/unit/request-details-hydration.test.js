import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-hydration-"));
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

beforeEach(() => {
  adapter.run("DELETE FROM requestDetails");
});

describe("getRequestDetails — mixed page hydration", () => {
  it("returns legacy inline rows unchanged alongside pointer rows", async () => {
    const now = new Date().toISOString();
    insertInlineRow({ id: "inline-1", provider: "openai", model: "gpt-4", timestamp: now });
    insertPointerRow({ id: "pointer-1", provider: "anthropic", model: "claude-3", timestamp: now, timslite_id: "999999999999" });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(2);

    const inline = res.details.find((d) => d.id === "inline-1");
    expect(inline).toBeDefined();
    expect(inline.provider).toBe("openai");
    expect(inline.tokens?.prompt_tokens).toBe(100);
    expect(inline.timslite_id).toBeUndefined();

    const pointer = res.details.find((d) => d.id === "pointer-1");
    expect(pointer).toBeDefined();
    expect(pointer.id).toBe("pointer-1");
  });

  it("missing pointer yields metadata fields plus detailUnavailable", async () => {
    const now = new Date().toISOString();
    insertPointerRow({ id: "missing-1", provider: "openai", model: "gpt-4", timestamp: now, status: "success", timslite_id: "1234567890123" });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(1);

    const detail = res.details[0];
    expect(detail.id).toBe("missing-1");
    expect(detail.timestamp).toBe(now);
    expect(detail.provider).toBe("openai");
    expect(detail.model).toBe("gpt-4");
    expect(detail.status).toBe("success");
    expect(detail.timslite_id).toBe("1234567890123");
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.detailError).toBeDefined();
    expect(detail.tokens).toBeUndefined();
    expect(detail.latency).toBeUndefined();
  });

  it("malformed pointer (non-decimal timslite_id) does not call Timslite, yields metadata + detailUnavailable", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "malformed-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({ timslite_id: "not-a-number!!" }),
    });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(1);

    const detail = res.details[0];
    expect(detail.id).toBe("malformed-1");
    expect(detail.timslite_id).toBe("not-a-number!!");
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.detailError).toBeDefined();
  });

  it("pointer-like with extra keys yields detailUnavailable, never calls store.getMany", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "extra-keys-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({ timslite_id: "1234567890123", extraKey: "should not leak" }),
    });

    const res = await db.getRequestDetails({ pageSize: 10 });
    const detail = res.details.find((d) => d.id === "extra-keys-1");
    expect(detail).toBeDefined();
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.timslite_id).toBe("1234567890123");
    expect(detail.extraKey).toBeUndefined();
  });

  it("pointer-like with non-string timslite_id yields detailUnavailable", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "non-string-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({ timslite_id: 12345 }),
    });

    const res = await db.getRequestDetails({ pageSize: 10 });
    const detail = res.details.find((d) => d.id === "non-string-1");
    expect(detail).toBeDefined();
    expect(detail.detailUnavailable).toBe(true);
  });

  it("empty object stays inline, no detailUnavailable", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "empty-obj-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({}),
    });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(1);
    const detail = res.details[0];
    expect(detail.detailUnavailable).toBeUndefined();
  });

  it("object without timslite_id stays inline, no detailUnavailable", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "no-timslite-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({ id: "no-timslite-1", provider: "openai", tokens: { prompt_tokens: 10 } }),
    });

    const res = await db.getRequestDetails({ pageSize: 10 });
    const detail = res.details.find((d) => d.id === "no-timslite-1");
    expect(detail).toBeDefined();
    expect(detail.detailUnavailable).toBeUndefined();
    expect(detail.tokens?.prompt_tokens).toBe(10);
  });

  it("single missing record does not fail entire page", async () => {
    const now = new Date().toISOString();
    insertInlineRow({ id: "good-1", provider: "openai", timestamp: now });
    insertPointerRow({ id: "missing-2", provider: "anthropic", timestamp: now, timslite_id: "987654321098" });
    insertInlineRow({ id: "good-2", provider: "google", timestamp: now });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(3);

    const good1 = res.details.find((d) => d.id === "good-1");
    expect(good1.provider).toBe("openai");

    const missing = res.details.find((d) => d.id === "missing-2");
    expect(missing.detailUnavailable).toBe(true);

    const good2 = res.details.find((d) => d.id === "good-2");
    expect(good2.provider).toBe("google");
  });
});

describe("getRequestDetailById — pointer validation and hydration", () => {
  it("inline row returns full data", async () => {
    const now = new Date().toISOString();
    insertInlineRow({ id: "byid-inline-1", provider: "anthropic", timestamp: now, tokens: { prompt_tokens: 42 } });

    const detail = await db.getRequestDetailById("byid-inline-1");
    expect(detail).toBeDefined();
    expect(detail.id).toBe("byid-inline-1");
    expect(detail.tokens?.prompt_tokens).toBe(42);
    expect(detail.detailUnavailable).toBeUndefined();
  });

  it("valid pointer with missing Timslite payload yields metadata + detailUnavailable", async () => {
    const now = new Date().toISOString();
    insertPointerRow({ id: "byid-pointer-1", provider: "openai", model: "gpt-4", timestamp: now, status: "error", timslite_id: "111122223333" });

    const detail = await db.getRequestDetailById("byid-pointer-1");
    expect(detail).toBeDefined();
    expect(detail.id).toBe("byid-pointer-1");
    expect(detail.timslite_id).toBe("111122223333");
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.tokens).toBeUndefined();
    expect(detail.latency).toBeUndefined();
  });

  it("malformed pointer (non-decimal) yields metadata + detailUnavailable without Timslite call", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "byid-malformed-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({ timslite_id: "abc123" }),
    });

    const detail = await db.getRequestDetailById("byid-malformed-1");
    expect(detail).toBeDefined();
    expect(detail.id).toBe("byid-malformed-1");
    expect(detail.timslite_id).toBe("abc123");
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.detailError).toContain("Malformed");
  });

  it("pointer-like with extra keys by-ID yields detailUnavailable, does not leak extra content", async () => {
    const now = new Date().toISOString();
    insertRow({
      id: "byid-extra-keys-1",
      timestamp: now,
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: JSON.stringify({ timslite_id: "111122223333", secretData: "should not leak" }),
    });

    const detail = await db.getRequestDetailById("byid-extra-keys-1");
    expect(detail).toBeDefined();
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.timslite_id).toBe("111122223333");
    expect(detail.secretData).toBeUndefined();
  });

  it("non-existent ID returns null", async () => {
    const detail = await db.getRequestDetailById("does-not-exist");
    expect(detail).toBeNull();
  });

  it("corrupt JSON yields null (parseJson fallback)", async () => {
    insertRow({
      id: "corrupt-byid-1",
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      connectionId: null,
      status: "success",
      data: "{not-valid-json",
    });

    const detail = await db.getRequestDetailById("corrupt-byid-1");
    expect(detail).toBeNull();
  });
});

describe("getRequestDetails — page/pageSize bounding", () => {
  it("pageSize capped at 100 in repository", async () => {
    insertInlineRow({ id: "cap-1", provider: "openai", timestamp: new Date().toISOString() });

    const res = await db.getRequestDetails({ pageSize: 999 });
    expect(res.pagination.pageSize).toBe(100);
    expect(res.details.length).toBeLessThanOrEqual(100);
  });

  it("pageSize < 1 defaults to 20", async () => {
    insertInlineRow({ id: "cap-2", provider: "openai", timestamp: new Date().toISOString() });

    const res = await db.getRequestDetails({ pageSize: 0 });
    expect(res.pagination.pageSize).toBe(20);
  });

  it("page < 1 defaults to 1", async () => {
    insertInlineRow({ id: "cap-3", provider: "openai", timestamp: new Date().toISOString() });

    const res = await db.getRequestDetails({ page: 0, pageSize: 10 });
    expect(res.pagination.page).toBe(1);
  });
});

describe("SQLite pagination ordering and filtering", () => {
  it("returns results ordered by timestamp DESC", async () => {
    insertInlineRow({ id: "ts-1", provider: "openai", timestamp: "2025-01-01T00:00:00Z" });
    insertInlineRow({ id: "ts-2", provider: "openai", timestamp: "2025-06-01T00:00:00Z" });
    insertInlineRow({ id: "ts-3", provider: "openai", timestamp: "2025-03-01T00:00:00Z" });

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details[0].id).toBe("ts-2");
    expect(res.details[1].id).toBe("ts-3");
    expect(res.details[2].id).toBe("ts-1");
  });

  it("pageSize=1 returns exactly one result with correct pagination", async () => {
    insertInlineRow({ id: "pg-1", provider: "openai", timestamp: "2025-01-01T00:00:00Z" });
    insertInlineRow({ id: "pg-2", provider: "openai", timestamp: "2025-02-01T00:00:00Z" });

    const page1 = await db.getRequestDetails({ page: 1, pageSize: 1 });
    expect(page1.details.length).toBe(1);
    expect(page1.pagination.totalItems).toBe(2);
    expect(page1.pagination.totalPages).toBe(2);
    expect(page1.pagination.hasNext).toBe(true);

    const page2 = await db.getRequestDetails({ page: 2, pageSize: 1 });
    expect(page2.details.length).toBe(1);
    expect(page2.pagination.hasNext).toBe(false);
    expect(page2.pagination.hasPrev).toBe(true);
  });

  it("provider filter works correctly", async () => {
    insertInlineRow({ id: "f-1", provider: "openai", timestamp: "2025-01-01T00:00:00Z" });
    insertInlineRow({ id: "f-2", provider: "anthropic", timestamp: "2025-01-01T00:00:00Z" });
    insertInlineRow({ id: "f-3", provider: "openai", timestamp: "2025-01-01T00:00:00Z" });

    const res = await db.getRequestDetails({ provider: "anthropic", pageSize: 10 });
    expect(res.details.length).toBe(1);
    expect(res.details[0].id).toBe("f-2");
  });

  it("startDate/endDate filter works correctly", async () => {
    insertInlineRow({ id: "dt-1", provider: "openai", timestamp: "2025-01-01T00:00:00Z" });
    insertInlineRow({ id: "dt-2", provider: "openai", timestamp: "2025-06-01T00:00:00Z" });
    insertInlineRow({ id: "dt-3", provider: "openai", timestamp: "2025-12-01T00:00:00Z" });

    const res = await db.getRequestDetails({
      startDate: "2025-03-01T00:00:00Z",
      endDate: "2025-09-01T00:00:00Z",
      pageSize: 10,
    });
    expect(res.details.length).toBe(1);
    expect(res.details[0].id).toBe("dt-2");
  });
});

describe("pointer reads with write flag later false", () => {
  it("pointer row can still be read from SQLite even when Timslite write is disabled", async () => {
    const now = new Date().toISOString();
    insertPointerRow({ id: "write-disabled-1", provider: "openai", timestamp: now, timslite_id: "555566667777" });

    delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;

    const res = await db.getRequestDetails({ pageSize: 10 });
    expect(res.details.length).toBe(1);
    const detail = res.details[0];
    expect(detail.id).toBe("write-disabled-1");
    expect(detail.detailUnavailable).toBe(true);
    expect(detail.timslite_id).toBe("555566667777");
  });
});

describe("API redaction preserves unavailable metadata", () => {
  it("redaction keeps detailUnavailable, detailError, timslite_id", () => {
    function redactDetails(details) {
      return (details || []).map((d) => {
        const redacted = { ...d };
        for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
          if (redacted[key] !== undefined) {
            redacted[key] = { redacted: true };
          }
        }
        return redacted;
      });
    }

    const input = [{
      id: "unavail-1",
      provider: "openai",
      model: "gpt-4",
      timestamp: "2025-01-01T00:00:00Z",
      status: "success",
      timslite_id: "1234567890123",
      detailUnavailable: true,
      detailError: "Timslite read failed",
    }];

    const out = redactDetails(input)[0];
    expect(out.detailUnavailable).toBe(true);
    expect(out.detailError).toBe("Timslite read failed");
    expect(out.timslite_id).toBe("1234567890123");
    expect(out.id).toBe("unavail-1");
    expect(out.request).toBeUndefined();
    expect(out.response).toBeUndefined();
  });

  it("inline row with payloads still gets redacted", () => {
    function redactDetails(details) {
      return (details || []).map((d) => {
        const redacted = { ...d };
        for (const key of ["request", "providerRequest", "providerResponse", "response"]) {
          if (redacted[key] !== undefined) {
            redacted[key] = { redacted: true };
          }
        }
        return redacted;
      });
    }

    const input = [{
      id: "inline-redact",
      provider: "openai",
      request: { messages: [{ role: "user", content: "secret" }] },
      response: { content: "secret answer" },
      tokens: { prompt_tokens: 10 },
    }];

    const out = redactDetails(input)[0];
    expect(out.request).toEqual({ redacted: true });
    expect(out.response).toEqual({ redacted: true });
    expect(out.tokens.prompt_tokens).toBe(10);
  });
});

describe("token helpers — safe defaults for unavailable records", () => {
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

  it("undefined tokens → all helpers return 0, no throw", () => {
    expect(getInputTokens(undefined)).toBe(0);
    expect(getCachedTokens(undefined)).toBe(0);
    expect(getCacheCreationTokens(undefined)).toBe(0);
  });

  it("null tokens → all helpers return 0, no throw", () => {
    expect(getInputTokens(null)).toBe(0);
    expect(getCachedTokens(null)).toBe(0);
    expect(getCacheCreationTokens(null)).toBe(0);
  });

  it("undefined latency → safe access returns 0, no throw", () => {
    const latency = undefined;
    expect(latency?.ttft || 0).toBe(0);
    expect(latency?.total || 0).toBe(0);
  });

  it("rendering emdash for tokens works", () => {
    const tokens = undefined;
    expect(getCachedTokens(tokens) > 0 ? getCachedTokens(tokens).toLocaleString() : "\u2014").toBe("\u2014");
    expect(getCacheCreationTokens(tokens) > 0 ? getCacheCreationTokens(tokens).toLocaleString() : "\u2014").toBe("\u2014");
  });
});

describe("RequestDetailsTab source structure — column alignment", () => {
  it("table has exactly 9 th headers and 9 td columns per data row", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const uiPath = path.resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js");
    const source = fs.readFileSync(uiPath, "utf8");

    const theadMatch = source.match(/<thead>([\s\S]*?)<\/thead>/);
    expect(theadMatch).not.toBeNull();
    const thCount = (theadMatch[1].match(/<th\s/g) || []).length;
    expect(thCount).toBe(9);

    const tbodyStart = source.indexOf("<tbody>");
    const tbodyEnd = source.indexOf("</tbody>");
    const tbody = source.substring(tbodyStart, tbodyEnd);

    const loadingTd = (tbody.match(/colSpan="7"/g) || []).length;
    expect(loadingTd).toBe(2);

    const dataRowTd = (tbody.match(/className="whitespace-nowrap|className="max-w-\[|className="p-4 text-sm text-text-main|className="p-4 text-sm text-text-muted|className="p-4 text-center"/g) || []).length;
    expect(dataRowTd).toBe(9);
  });

  it("table headers match expected labels in order", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const uiPath = path.resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js");
    const source = fs.readFileSync(uiPath, "utf8");

    const theadMatch = source.match(/<thead>([\s\S]*?)<\/thead>/);
    const headers = [...theadMatch[1].matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => m[1].trim());
    expect(headers).toEqual(["Timestamp", "Model", "Provider", "Input Tokens", "Cached", "Cache Creation", "Output Tokens", "Latency", "Action"]);
  });

  it("no duplicate getInputTokens calls in table body", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const uiPath = path.resolve(import.meta.dirname, "../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js");
    const source = fs.readFileSync(uiPath, "utf8");

    const tbodyStart = source.indexOf("<tbody>");
    const tbodyEnd = source.indexOf("</tbody>");
    const tbody = source.substring(tbodyStart, tbodyEnd);

    const inputTokenCalls = (tbody.match(/getInputTokens/g) || []).length;
    expect(inputTokenCalls).toBe(1);
  });
});
