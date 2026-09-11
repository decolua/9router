import { describe, expect, it } from "vitest";
import { classifyAdaptiveFailure, ADAPTIVE_FAILURE_ACTION } from "../../open-sse/services/adaptiveFailureClassifier.js";
import { HARD_QUOTA_LOCK_DURATION_MS, HARD_QUOTA_PROVIDERS } from "../../open-sse/config/hardQuotaConfig.js";
const now = 1000000;
describe("hard quota 429 policy", () => {
  it.each(HARD_QUOTA_PROVIDERS)("locks %s for configured duration", provider => { expect(classifyAdaptiveFailure({ provider, model: "model-a", status: 429, error: "rate limited" }, now)).toMatchObject({ action: ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, expiresAtMs: now + HARD_QUOTA_LOCK_DURATION_MS }); });
  it("preserves trusted account quota precedence", () => { expect(classifyAdaptiveFailure({ provider: "claude", model: "m", status: 429, error: "project quota exceeded", resetsAtMs: now + 10000 }, now).action).toBe(ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK); });
  it("preserves model quota behavior without trusted reset", () => { expect(classifyAdaptiveFailure({ provider: "claude", model: "m", status: 429, error: "project quota exceeded" }, now).action).toBe(ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK); });
  it.each(["freebuff", "glm", "other"])("keeps %s transient", provider => { expect(classifyAdaptiveFailure({ provider, model: "m", status: 429, error: "rate limited" }, now).action).toBe(ADAPTIVE_FAILURE_ACTION.TRANSIENT_RETRY); });
  it("does not produce tracker input", () => { const result = classifyAdaptiveFailure({ provider: "codex", model: "m", status: 429, error: "rate limited" }, now); expect(result).not.toHaveProperty("tracker"); expect(result).not.toHaveProperty("breaker"); });
});
