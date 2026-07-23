import { describe, expect, it } from "vitest";
import { normalizeErrorCooldownPolicy, resolveErrorCooldown } from "../../open-sse/services/errorCooldownPolicy.js";
import { buildModelLockUpdate, isModelLockActive } from "../../open-sse/services/accountFallback.js";
import { parseErrorBody, parseProviderResetTime, parseUpstreamError } from "../../open-sse/utils/error.js";

const policy = normalizeErrorCooldownPolicy({
  enabled: true,
  timezone: "Asia/Shanghai",
  defaultDuration: { mode: "five-hours" },
  rules: [
    {
      name: "Quota",
      statuses: [429],
      codes: ["RATE_LIMIT_EXCEEDED"],
      message: "quota",
      scope: "key",
      duration: { mode: "custom", value: 1, unit: "days" },
    },
    {
      name: "Model only",
      statuses: [404],
      codes: [],
      message: "",
      scope: "model",
      duration: { mode: "five-hours" },
    },
  ],
});

describe("error cooldown policy", () => {
  it("matches all configured fields and skips model rules without a model", () => {
    const matched = resolveErrorCooldown(policy, {
      status: 429,
      code: "rate_limit_exceeded",
      message: "Daily QUOTA exhausted",
      model: "gpt-5",
      resetsAtMs: 30 * 86_400_000,
    }, 0);
    expect(matched).toEqual({ cooldownMs: 86_400_000, scope: "key", source: "rule", rule: "Quota" });

    const skipped = resolveErrorCooldown(policy, { status: 404, message: "missing", model: null }, 0);
    expect(skipped.cooldownMs).toBe(18_000_000);
    expect(skipped.source).toBe("default");

    const modelOnly = resolveErrorCooldown(policy, { status: 404, message: "missing", model: "gpt-5" }, 0);
    expect(modelOnly).toEqual({ cooldownMs: 18_000_000, scope: "model", source: "rule", rule: "Model only" });
  });

  it("uses the default for every unmatched error", () => {
    const result = resolveErrorCooldown(policy, { message: "network failure", resetsAtMs: 40 * 86_400_000 }, 0);
    expect(result).toEqual({ cooldownMs: 18_000_000, scope: "key", source: "default", rule: null });
  });

  it("supports all fixed cooldown durations", () => {
    const expected = { "half-hour": 1_800_000, "one-hour": 3_600_000, "five-hours": 18_000_000, "one-day": 86_400_000 };
    for (const [mode, cooldownMs] of Object.entries(expected)) {
      const result = resolveErrorCooldown({ ...policy, defaultDuration: { mode }, rules: [] }, { status: 500 }, 0);
      expect(result.cooldownMs).toBe(cooldownMs);
    }
  });

  it("calculates end of the configured local day", () => {
    const endOfDayPolicy = { ...policy, defaultDuration: { mode: "end-of-day" }, rules: [] };
    const now = Date.parse("2026-07-23T10:00:00.000Z");
    const result = resolveErrorCooldown(endOfDayPolicy, { status: 500 }, now);
    expect(new Date(now + result.cooldownMs).toISOString()).toBe("2026-07-23T16:00:00.000Z");

    const dstPolicy = { ...endOfDayPolicy, timezone: "America/New_York" };
    const dstNow = Date.parse("2026-03-08T06:00:00.000Z");
    const dstResult = resolveErrorCooldown(dstPolicy, { status: 500 }, dstNow);
    expect(new Date(dstNow + dstResult.cooldownMs).toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("drops empty rules and rejects invalid custom durations", () => {
    const normalized = normalizeErrorCooldownPolicy({
      enabled: true,
      timezone: "UTC",
      defaultDuration: { mode: "five-hours" },
      rules: [{ name: "ignored", statuses: [], codes: [], message: "" }],
    });
    expect(normalized.rules).toEqual([]);
    expect(normalizeErrorCooldownPolicy({ ...normalized, enabled: false })).toEqual({ ...normalized, enabled: false });
    expect(() => normalizeErrorCooldownPolicy({
      enabled: true,
      timezone: "UTC",
      defaultDuration: { mode: "custom", value: 31, unit: "days" },
      rules: [],
    })).toThrow("between 1 minute and 30 days");
  });

  it("never shortens an existing cooldown", () => {
    const existingUntil = new Date(Date.now() + 60_000).toISOString();
    const update = buildModelLockUpdate("gpt-5", 1_000, { "modelLock_gpt-5": existingUntil });
    expect(update["modelLock_gpt-5"]).toBe(existingUntil);
  });

  it("keeps an all-key lock active when a model lock has expired", () => {
    expect(isModelLockActive({
      "modelLock_gpt-5": new Date(Date.now() - 1_000).toISOString(),
      modelLock___all: new Date(Date.now() + 60_000).toISOString(),
    }, "gpt-5")).toBe(true);
  });

  it("reads Retry-After and resets_at as absolute recovery times", () => {
    const now = Date.parse("2026-07-23T00:00:00.000Z");
    const response = { headers: new Headers({ "Retry-After": "300" }) };
    const body = JSON.stringify({ error: { resets_at: (now + 600_000) / 1000 } });
    expect(parseProviderResetTime(response, body, now)).toBe(now + 600_000);
    expect(parseErrorBody("<html><title>Gateway denied</title></html>")).toEqual({ message: "Gateway denied", code: null });
  });

  it("extracts error.message when an executor returns the raw body", async () => {
    const body = JSON.stringify({ error: { message: "Quota exhausted", code: "quota" } });
    const result = await parseUpstreamError(new Response(body, { status: 429 }), {
      parseError: (response, bodyText) => ({ status: response.status, message: bodyText }),
    });
    expect(result.message).toBe("Quota exhausted");
    expect(result.errorCode).toBe("quota");
  });
});
