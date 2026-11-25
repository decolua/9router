import { describe, it, expect, vi, beforeEach } from "vitest";

// GET dispatches to getApiKeyUsageSeries (JSON path) and getUsageStats (CSV
// path) — mocked here the same way tests/unit/api-key-usage-series.test.js
// mocks the DB layer, so these tests exercise the route's own logic (period
// validation, JSON shape, CSV headers) without touching SQLite.
const mockSeriesResult = { series: [{ label: "Mon", byKey: { "key-1": 42 } }], keys: { "key-1": "hermes" } };
const mockByApiKey = {
  "key-1|claude-cli-opus-1m|claude-cli": {
    requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10, cost: 0.5,
    rawModel: "claude-cli-opus-1m", provider: "Claude Code CLI", keyName: "hermes",
    lastUsed: "2026-09-25",
  },
};
const getApiKeyUsageSeries = vi.fn(async () => mockSeriesResult);
const getUsageStats = vi.fn(async () => ({ byApiKey: mockByApiKey }));

vi.mock("@/lib/db/repos/apiKeyUsageRepo.js", () => ({ getApiKeyUsageSeries: (...args) => getApiKeyUsageSeries(...args) }));
vi.mock("@/lib/usageDb", () => ({ getUsageStats: (...args) => getUsageStats(...args) }));

const { toCsv, GET } = await import("@/app/api/usage/api-keys/route.js");

describe("toCsv", () => {
  const byApiKey = {
    "key-1|claude-cli-opus-1m|claude-cli": {
      requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10, cost: 0.5,
      rawModel: "claude-cli-opus-1m", provider: "Claude Code CLI", keyName: "hermes",
      lastUsed: "2026-09-25",
    },
  };

  it("writes a header and one line per key/model pair", () => {
    const lines = toCsv(byApiKey).trim().split("\n");
    expect(lines[0]).toBe("key,model,provider,requests,promptTokens,completionTokens,cachedTokens,cost,lastUsed");
    expect(lines[1]).toBe("hermes,claude-cli-opus-1m,Claude Code CLI,2,100,50,10,0.5,2026-09-25");
  });

  it("quotes a field containing a comma so the columns do not shift", () => {
    const csv = toCsv({ "k|m|p": { keyName: 'my key, v2', rawModel: "m", provider: "p", requests: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" } });
    expect(csv).toContain('"my key, v2"');
  });

  it("escapes an embedded quote rather than breaking the field", () => {
    const csv = toCsv({ "k|m|p": { keyName: 'say "hi"', rawModel: "m", provider: "p", requests: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" } });
    expect(csv).toContain('"say ""hi"""');
  });

  it("returns only a header when there is nothing to export", () => {
    expect(toCsv({}).trim()).toBe("key,model,provider,requests,promptTokens,completionTokens,cachedTokens,cost,lastUsed");
  });

  it("quotes a keyName containing a newline, embedding it inside the quotes", () => {
    const csv = toCsv({ "k|m|p": { keyName: "line1\nline2", rawModel: "m", provider: "p", requests: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" } });
    // A naive split("\n") sees 3 lines here — the embedded newline is only
    // "inside" the row to a parser that respects the quoting, which is what
    // matters: the field survived intact between one pair of quotes.
    expect(csv).toContain('"line1\nline2"');
    expect(csv.startsWith(`${[
      "key", "model", "provider", "requests", "promptTokens", "completionTokens", "cachedTokens", "cost", "lastUsed",
    ].join(",")}\n"line1\nline2",m,p,1,0,0,0,0,`)).toBe(true);
  });

  it("does not need quoting for a deleted key's hash-based label", () => {
    const csv = toCsv({ "k|m|p": { keyName: "(deleted) a1b2c3d4", rawModel: "m", provider: "p", requests: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, lastUsed: "" } });
    const lines = csv.trim().split("\n");
    expect(lines[1]).toBe("(deleted) a1b2c3d4,m,p,1,0,0,0,0,");
  });
});

describe("GET /api/usage/api-keys", () => {
  beforeEach(() => {
    getApiKeyUsageSeries.mockClear();
    getUsageStats.mockClear();
  });

  it("400s on a period outside the set /api/usage/stats accepts", async () => {
    const response = await GET(new Request("http://localhost/api/usage/api-keys?period=bogus"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid period" });
    expect(getApiKeyUsageSeries).not.toHaveBeenCalled();
    expect(getUsageStats).not.toHaveBeenCalled();
  });

  it("returns the series and keys from getApiKeyUsageSeries for a valid period", async () => {
    const response = await GET(new Request("http://localhost/api/usage/api-keys?period=30d"));
    expect(getApiKeyUsageSeries).toHaveBeenCalledWith("30d");
    expect(await response.json()).toEqual(mockSeriesResult);
  });

  it("defaults to 7d when no period is given", async () => {
    await GET(new Request("http://localhost/api/usage/api-keys"));
    expect(getApiKeyUsageSeries).toHaveBeenCalledWith("7d");
  });

  it("serves the CSV export, built from the same byApiKey the table renders", async () => {
    const response = await GET(new Request("http://localhost/api/usage/api-keys?period=7d&format=csv"));
    expect(getUsageStats).toHaveBeenCalledWith("7d");
    expect(getApiKeyUsageSeries).not.toHaveBeenCalled();
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="api-key-usage-7d.csv"');
    expect(await response.text()).toBe(toCsv(mockByApiKey));
  });

  it("400s on format=csv with an invalid period too", async () => {
    const response = await GET(new Request("http://localhost/api/usage/api-keys?period=bogus&format=csv"));
    expect(response.status).toBe(400);
    expect(getUsageStats).not.toHaveBeenCalled();
  });
});
