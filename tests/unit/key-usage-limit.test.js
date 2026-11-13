import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validateUsageLimitsInput,
  findExceededLimit,
  getPeriodStart,
  getPeriodEnd,
  usageLimitsFromColumn,
  usageLimitsToColumn,
} from "@/shared/utils/keyUsageLimit.js";

describe("key usage limit helpers", () => {
  it("validates input and rejects unknown fields / bad numbers", () => {
    expect(validateUsageLimitsInput(null)).toEqual({ ok: true, value: {} });
    expect(validateUsageLimitsInput({ daily: { maxCost: 1.5, maxTokens: null } }))
      .toEqual({ ok: true, value: { daily: { maxCost: 1.5 } } });
    expect(validateUsageLimitsInput({ yearly: {} }).ok).toBe(false);
    expect(validateUsageLimitsInput({ daily: { foo: 1 } }).ok).toBe(false);
    expect(validateUsageLimitsInput({ daily: { maxCost: -1 } }).ok).toBe(false);
    expect(validateUsageLimitsInput({ daily: { maxCost: "5" } }).ok).toBe(false);
  });

  it("round-trips through the DB column and treats corrupt JSON as no limits", () => {
    const limits = { weekly: { maxInputTokens: 100 } };
    expect(usageLimitsFromColumn(usageLimitsToColumn(limits))).toEqual(limits);
    expect(usageLimitsToColumn({})).toBeNull();
    expect(usageLimitsFromColumn("{not json")).toEqual({});
  });

  it("finds the first exhausted metric across total / input / output / cost", () => {
    const limits = { daily: { maxTokens: 100 }, monthly: { maxOutputTokens: 50, maxCost: 2 } };
    expect(findExceededLimit(limits, { daily: { inputTokens: 40, outputTokens: 50 }, monthly: { outputTokens: 49, cost: 1 } })).toBeNull();
    expect(findExceededLimit(limits, { daily: { inputTokens: 60, outputTokens: 40 } }))
      .toMatchObject({ period: "daily", metric: "maxTokens", used: 100, max: 100 });
    expect(findExceededLimit(limits, { daily: {}, monthly: { outputTokens: 10, cost: 2.5 } }))
      .toMatchObject({ period: "monthly", metric: "maxCost" });
  });

  it("computes period boundaries (week starts Monday)", () => {
    const wed = new Date(2026, 10, 11, 15, 30); // Wed Nov 11 2026
    expect(getPeriodStart("daily", wed)).toEqual(new Date(2026, 10, 11));
    expect(getPeriodStart("weekly", wed)).toEqual(new Date(2026, 10, 9));
    expect(getPeriodEnd("weekly", wed)).toEqual(new Date(2026, 10, 16));
    expect(getPeriodStart("monthly", wed)).toEqual(new Date(2026, 10, 1));
    expect(getPeriodEnd("monthly", wed)).toEqual(new Date(2026, 11, 1));
    const sun = new Date(2026, 10, 15, 23, 0);
    expect(getPeriodStart("weekly", sun)).toEqual(new Date(2026, 10, 9));
  });
});

describe("key usage limit DB check", () => {
  let tempDir;
  let db;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-limit-"));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  it("aggregates usage per key and blocks once a limit is reached", async () => {
    const created = await db.createApiKey("limited", "machine-1");
    const other = "sk-other-key-0000";
    await db.saveRequestUsage({ provider: "openai", model: "gpt-4", apiKey: created.key, tokens: { prompt_tokens: 30, completion_tokens: 10 } });
    await db.saveRequestUsage({ provider: "openai", model: "gpt-4", apiKey: other, tokens: { prompt_tokens: 999, completion_tokens: 999 } });

    const usage = await db.getApiKeyUsageByPeriods(created.key, { daily: getPeriodStart("daily") });
    expect(usage.daily).toMatchObject({ inputTokens: 30, outputTokens: 10, requests: 1 });

    const { checkKeyUsageLimit } = await import("@/lib/keyUsageLimit.js");
    expect(await checkKeyUsageLimit(created.key)).toBeNull();

    await db.updateApiKey(created.id, { usageLimits: { daily: { maxTokens: 100 } } });
    expect(await checkKeyUsageLimit(created.key)).toBeNull();

    await db.updateApiKey(created.id, { usageLimits: { daily: { maxTokens: 40 } } });
    expect(await checkKeyUsageLimit(created.key)).toMatchObject({ period: "daily", metric: "maxTokens", used: 40, max: 40 });

    const reloaded = await db.getApiKeyById(created.id);
    expect(reloaded.usageLimits).toEqual({ daily: { maxTokens: 40 } });
  });
});
