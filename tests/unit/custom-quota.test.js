import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import {
  CUSTOM_QUOTA_SETTINGS_KEY,
  fetchCustomQuota,
  fillCustomQuotaTemplate,
  parseCustomResetAt,
  readPath,
  resolveCustomQuota,
  validateCustomQuotaConfig,
} from "@/lib/customQuota.js";

const baseConfig = (quotas, extra = {}) => ({
  plan: "Custom",
  request: { url: "https://api.example.com/usage", method: "GET", headers: [] },
  quotas,
  ...extra,
});

describe("readPath", () => {
  const body = {
    data: {
      limits: [
        { type: "five_hour", used: 20, limit: 100, resetsAt: "2026-01-01T00:00:00Z" },
        { type: "weekly", used: 50, limit: 200 },
      ],
      balance: { amount: "12,345.5" },
    },
  };

  it("reads dotted and bracketed paths", () => {
    expect(readPath(body, "data.limits[1].used")).toBe(50);
    expect(readPath(body, "data.balance.amount")).toBe("12,345.5");
  });

  it("expands wildcards into arrays", () => {
    expect(readPath(body, "data.limits[*].used")).toEqual([20, 50]);
  });

  it("returns undefined for missing paths", () => {
    expect(readPath(body, "data.missing.value")).toBeUndefined();
  });
});

describe("resolveCustomQuota", () => {
  it("computes remaining from used/total", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Monthly", usedPath: "used", totalPath: "limit", unit: "requests" }]),
      { used: 25, limit: 100 },
    );
    expect(result.quotas).toHaveLength(1);
    expect(result.quotas[0]).toMatchObject({ name: "Monthly", used: 25, total: 100, remaining: 75, unit: "requests" });
  });

  it("expands itemsPath into one row per item using namePath", () => {
    const config = baseConfig(
      [{ name: "Limit", namePath: "type", usedPath: "used", totalPath: "limit", resetAtPath: "resetsAt" }],
      { itemsPath: "data.limits[*]" },
    );
    const result = resolveCustomQuota(config, {
      data: { limits: [{ type: "5h", used: 10, limit: 40, resetsAt: "2026-01-01T00:00:00Z" }, { type: "7d", used: 5, limit: 20 }] },
    });
    expect(result.quotas.map((quota) => quota.name)).toEqual(["5h", "7d"]);
    expect(result.quotas[0].remaining).toBe(75);
    expect(result.quotas[0].resetAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.quotas[1].resetAt).toBeNull();
  });

  it("supports percent-only sources", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Session", percentUsedPath: "percent" }]),
      { percent: 30 },
    );
    expect(result.quotas[0]).toMatchObject({ used: 30, total: 100, remaining: 70, unit: "%" });
  });

  it("supports percent-remaining sources", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Weekly", percentRemainingPath: "remaining" }]),
      { remaining: 12.5 },
    );
    expect(result.quotas[0]).toMatchObject({ used: 87.5, total: 100, remaining: 12.5 });
  });

  it("supports absolute remaining values", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Tokens", remainingPath: "left", totalPath: "limit" }]),
      { left: 300, limit: 1200 },
    );
    expect(result.quotas[0]).toMatchObject({ used: 900, total: 1200, remaining: 25 });
  });

  it("marks credit balances", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Balance", creditBalancePath: "balance", currency: "USD" }]),
      { balance: 42.5 },
    );
    expect(result.quotas[0]).toMatchObject({ isCreditBalance: true, total: 42.5, currency: "USD" });
  });

  it("marks unlimited quotas", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Unlimited", usedPath: "used", unlimitedPath: "unlimited" }]),
      { used: 7, unlimited: true },
    );
    expect(result.quotas[0]).toMatchObject({ unlimited: true, total: 0, used: 7, remaining: 100 });
  });

  it("reports a message when nothing matches", () => {
    const result = resolveCustomQuota(
      baseConfig([{ name: "Missing", usedPath: "nope.used", totalPath: "nope.limit" }]),
      {},
    );
    expect(result.quotas).toEqual([]);
    expect(result.message).toMatch(/no values matched/i);
  });
});

describe("parseCustomResetAt", () => {
  it("parses ISO strings", () => {
    expect(parseCustomResetAt("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("parses epoch seconds and milliseconds", () => {
    expect(parseCustomResetAt(1767225600, "unix")).toBe("2026-01-01T00:00:00.000Z");
    expect(parseCustomResetAt(1767225600000, "unix_ms")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("parses relative seconds", () => {
    const before = Date.now();
    const parsed = Date.parse(parseCustomResetAt(60, "seconds_from_now"));
    expect(parsed).toBeGreaterThanOrEqual(before + 59000);
    expect(parsed).toBeLessThanOrEqual(Date.now() + 61000);
  });

  it("rejects missing values", () => {
    expect(parseCustomResetAt(null)).toBeNull();
    expect(parseCustomResetAt("")).toBeNull();
  });
});

describe("fillCustomQuotaTemplate", () => {
  it("fills connection variables", () => {
    const text = fillCustomQuotaTemplate("{{baseUrl}}/usage?key={{apiKey}}&p={{provider}}", {
      apiKey: "secret",
      provider: "openai-compatible-acme",
      providerSpecificData: { baseUrl: "https://llm.example.com/v1" },
    });
    expect(text).toBe("https://llm.example.com/v1/usage?key=secret&p=openai-compatible-acme");
  });

  it("replaces unknown variables with empty strings", () => {
    expect(fillCustomQuotaTemplate("a{{missing}}b", {})).toBe("ab");
  });
});

describe("validateCustomQuotaConfig", () => {
  it("accepts a minimal source", () => {
    expect(validateCustomQuotaConfig(baseConfig([{ name: "Q", usedPath: "used" }]))).toEqual([]);
  });

  it("rejects missing URL and paths", () => {
    const errors = validateCustomQuotaConfig({ request: { url: "" }, quotas: [{ name: "Q" }] });
    expect(errors.join(" ")).toMatch(/URL is required/);
    expect(errors.join(" ")).toMatch(/at least one value path/);
  });

  it("exports the settings key", () => {
    expect(CUSTOM_QUOTA_SETTINGS_KEY).toBe("customQuotaSources");
  });
});

describe("fetchCustomQuota", () => {
  const server = http.createServer((request, response) => {
    if (request.headers.authorization !== "Bearer test-key") {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ info: { spend: 2.5, max_budget: 10, budget_reset_at: "2026-12-01T00:00:00Z" } }));
  });

  let baseUrl;

  beforeAll(async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("requests the configured endpoint and resolves rows", async () => {
    const config = {
      plan: "Gateway",
      request: {
        url: "{{baseUrl}}/key/info",
        method: "GET",
        headers: [{ name: "Authorization", value: "Bearer {{apiKey}}" }],
      },
      quotas: [{ name: "Budget", usedPath: "info.spend", totalPath: "info.max_budget", unit: "USD", resetAtPath: "info.budget_reset_at" }],
    };

    const result = await fetchCustomQuota(
      config,
      { apiKey: "test-key", providerSpecificData: { baseUrl } },
      { allowPrivateHosts: true },
    );

    expect(result.quotas[0]).toMatchObject({ name: "Budget", used: 2.5, total: 10, remaining: 75, unit: "USD" });
    expect(result.quotas[0].resetAt).toBe("2026-12-01T00:00:00.000Z");
  });

  it("reports auth failures without throwing", async () => {
    const result = await fetchCustomQuota(
      {
        request: { url: `${baseUrl}/key/info`, method: "GET", headers: [{ name: "Authorization", value: "Bearer wrong" }] },
        quotas: [{ name: "Budget", usedPath: "info.spend", totalPath: "info.max_budget" }],
      },
      {},
      { allowPrivateHosts: true },
    );
    expect(result.message).toMatch(/401/);
  });
});
