// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      expect(checkFallbackError(status, "nope").shouldFallback).toBe(true);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it.each([
    "You have insufficient credits to make this request. Please purchase more credits to continue using the service.",
    "INSUFFICIENT CREDITS",
    "Insufficient credit balance",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "CREDIT BALANCE IS TOO LOW",
  ])("falls back with backoff for a 400 credit error: %s", (message) => {
    expect(checkFallbackError(400, message)).toEqual({
      shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1,
    });
    expect(checkFallbackError(400, message, 1)).toEqual({
      shouldFallback: true, cooldownMs: 4000, newBackoffLevel: 2,
    });
  });

  it("does not fall back for an ordinary bad request", () => {
    expect(checkFallbackError(400, "Bad request")).toEqual({
      shouldFallback: false, cooldownMs: 0, requestScoped: true,
    });
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it.each([
    '{"code":11158,"msg":"model [gpt-6-luna] is not allowed for user type [personal_free_user]","displayMsg":{"en":"Your account type does not support this model.","zh":"当前账号类型暂不支持该模型。"}}',
    "当前账号类型暂不支持该模型。",
    "Your account type does not support this model.",
    '{"error":{"code":"MODEL_NOT_IN_PLAN","message":"Model not included in plan"}}',
    '{"code":14018,"msg":"credits exhausted"}',
    "额度已用尽",
  ])("falls back with 2m cooldown for account/plan model restriction or exhausted credits on 400: %s", (message) => {
    expect(checkFallbackError(400, message)).toEqual({
      shouldFallback: true,
      cooldownMs: 120000,
    });
  });

  it("cools down for 30m when CodeBuddy returns 11140 unusual activity account restriction", () => {
    expect(
      checkFallbackError(
        403,
        '{"code":11140,"msg":"request illegal","displayMsg":{"en":"Your account has been restricted due to unusual activity","zh":"账号存在异常行为，已被限制使用"}}',
        0,
        "codebuddy-intl"
      )
    ).toEqual({
      shouldFallback: true,
      cooldownMs: 1800000,
    });
  });
});
