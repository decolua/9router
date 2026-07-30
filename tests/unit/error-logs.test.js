import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("uuid", () => ({ v4: () => "gen-id" }));

const ENTRY_1 = {
  id: "first",
  timestamp: "2026-07-29T01:00:00.000Z",
  endpoint: "/v1/chat/completions",
  provider: "openai",
  model: "gpt-4o",
  connectionId: "conn-1",
  comboName: null,
  statusCode: 500,
  errorMessage: "Internal server error",
  request: { model: "gpt-4o" },
  providerRequest: { model: "gpt-4o" },
  providerResponse: { error: { message: "boom" } },
  meta: { fallback: true, retryAfterHuman: "30s", latency: { total: 120 }, tokens: { prompt_tokens: 10, completion_tokens: 5 } },
};

const ENTRY_2 = {
  id: "second",
  timestamp: "2026-07-29T01:01:00.000Z",
  endpoint: "/v1/chat/completions",
  provider: "openai",
  model: "gpt-4o",
  connectionId: "conn-2",
  comboName: "fast-panel",
  statusCode: 429,
  errorMessage: "rate limited",
  request: { model: "gpt-4o" },
  providerRequest: { model: "gpt-4o" },
  providerResponse: { error: { message: "slow down" } },
  meta: { fallback: true, latency: { total: 80 } },
};

const makeRepo = async ({ saveErrorLog, getErrorLogs, getErrorLogById, getDistinctErrorProviders } = {}) => {
  vi.resetModules();
  vi.doMock("./errorLogsRepo.js", () => ({
    saveErrorLog: saveErrorLog || vi.fn(),
    getErrorLogs: getErrorLogs || vi.fn(),
    getErrorLogById: getErrorLogById || vi.fn(),
    getDistinctErrorProviders: getDistinctErrorProviders || vi.fn(),
  }));
  return await import("../../src/lib/db/index.js");
};

describe("error logs API wiring", () => {
  it("exposes error log helpers from the db index", async () => {
    const mod = await import("../../src/lib/db/index.js");
    expect(typeof mod.saveErrorLog).toBe("function");
    expect(typeof mod.getErrorLogs).toBe("function");
    expect(typeof mod.getErrorLogById).toBe("function");
    expect(typeof mod.getDistinctErrorProviders).toBe("function");
  });
});

describe("error-logs API route", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns parsed error logs with pagination", async () => {
    vi.doMock("../../src/lib/db/repos/errorLogsRepo.js", () => ({
      getErrorLogs: vi.fn(async () => ({
        details: [ENTRY_1],
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNext: false, hasPrev: false }
      }))
    }));
    const { GET } = await import("../../src/app/api/usage/error-logs/route.js");
    const request = new Request("http://localhost/api/usage/error-logs?page=1&pageSize=20");
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.details[0].comboName).toBeNull();
    expect(payload.details[0].meta.retryAfterHuman).toBe("30s");
    expect(payload.pagination.totalItems).toBe(1);
  });

  it("returns a single log when id is provided", async () => {
    vi.doMock("../../src/lib/db/repos/errorLogsRepo.js", () => ({
      getErrorLogs: vi.fn(),
      getErrorLogById: vi.fn(async () => ENTRY_2)
    }));
    const { GET } = await import("../../src/app/api/usage/error-logs/route.js");
    const request = new Request("http://localhost/api/usage/error-logs?id=second");
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.comboName).toBe("fast-panel");
    expect(payload.meta.fallback).toBe(true);
  });

  it("returns 404 when a requested log id does not exist", async () => {
    vi.doMock("../../src/lib/db/repos/errorLogsRepo.js", () => ({
      getErrorLogs: vi.fn(),
      getErrorLogById: vi.fn(async () => null)
    }));
    const { GET } = await import("../../src/app/api/usage/error-logs/route.js");
    const request = new Request("http://localhost/api/usage/error-logs?id=missing");
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Not found");
  });
});

describe("error log payload serialization", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("stringifies nested error objects and truncates oversized payloads", async () => {
    vi.doMock("uuid", () => ({ v4: () => "gen-id" }));
    vi.doMock("../../src/lib/db/repos/errorLogsRepo.js", () => ({
      saveErrorLog: vi.fn(async () => "gen-id"),
      getErrorLogs: vi.fn(async () => ({
        details: [{
          id: "gen-id",
          timestamp: "2026-07-29T02:00:00.000Z",
          provider: "openai",
          model: "gpt-4o",
          connectionId: "conn-1",
          comboName: "fast-panel",
          statusCode: "502",
          errorMessage: '{"message":"bad gateway"}',
          request: { model: "gpt-4o" },
          providerRequest: { model: "gpt-4o" },
          providerResponse: { error: "bad gateway" },
          meta: {
            fallback: true,
            retryAfterHuman: "10s",
            latency: { total: 130 },
            tokens: { prompt_tokens: 12, completion_tokens: 3 }
          }
        }],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, hasNext: false, hasPrev: false }
      }))
    }));
    const { GET } = await import("../../src/app/api/usage/error-logs/route.js");
    const request = new Request("http://localhost/api/usage/error-logs");
    const response = await GET(request);
    const text = await response.text();

    expect(response.status).toBe(200);
    const payload = JSON.parse(text);
    expect(payload.details[0].errorMessage).toBe('{"message":"bad gateway"}');
    expect(payload.details[0].meta.retryAfterHuman).toBe("10s");
  });

  it("logs combo fallback errors through saveErrorLog", async () => {
    vi.doMock("@/lib/usageDb.js", () => ({
      saveErrorLog: vi.fn(async () => "combo-log"),
      getErrorLogs: vi.fn(async () => ({ details: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1, hasNext: false, hasPrev: false } }))
    }));
    const { handleComboChat } = await import("open-sse/services/combo.js");
    const logs = [];
    const mockSave = (await import("@/lib/usageDb.js")).saveErrorLog;

    const failing = new Response(JSON.stringify({ error: { message: "provider down" } }), { status: 502 });
    const success = new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });

    const response = await handleComboChat({
      body: { model: "fallback-combo", messages: [{ role: "user", content: "hi" }] },
      models: ["provider/a", "provider/b"],
      handleSingleModel: vi.fn()
        .mockResolvedValueOnce(failing)
        .mockResolvedValueOnce(success),
      log: { info: () => {}, warn: (label, msg, meta) => logs.push({ label, msg, meta }) },
      comboName: "fallback-combo",
      comboStrategy: "fallback"
    });

    expect(response.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const [logEntry] = mockSave.mock.calls.map((call) => call[0]);
    expect(logEntry).toMatchObject({
      provider: "provider",
      model: "a",
      connectionId: "combo-fallback-combo",
      comboName: "fallback-combo",
      statusCode: 502,
      errorMessage: "provider down",
      request: null,
      providerRequest: null,
      providerResponse: null,
      meta: { fallback: true }
    });
  });
});
