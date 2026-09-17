// Regressions introduced by this fork on top of upstream, all of which degraded
// combo routing. Each block states the upstream behaviour being restored.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(async () => ({})),
  getComboByName: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));

import { getComboModels } from "../../src/sse/services/model.js";
import { getComboByName, getProviderConnections } from "@/lib/localDb";
import {
  buildAccountBreakerName,
  getCircuitBreaker,
  recordFailure,
  isBlocked,
  resetAllCircuitBreakers,
} from "open-sse/utils/circuitBreaker.js";
import { resolveAccountSemaphoreMaxConcurrency } from "open-sse/services/accountSemaphore.js";

beforeEach(() => {
  vi.clearAllMocks();
  getComboByName.mockImplementation(async () => null);
  getProviderConnections.mockImplementation(async () => []);
  resetAllCircuitBreakers();
});

function catalogConn(provider, models) {
  return {
    id: `${provider}-1`,
    provider,
    isActive: true,
    modelCatalog: { models, lastSuccessAt: new Date().toISOString(), lastError: null },
  };
}

describe("combo member filtering is fail-open", () => {
  // A catalog is a routing hint, never an authority over the user's combo. When
  // it would erase the whole combo the hint is wrong (stale sync, paginated or
  // plan-scoped listing), so the stored members must be tried and the real
  // provider error surfaced — not a synthetic 503 from an empty member list.
  it("keeps every member when the catalog would strip the whole combo", async () => {
    getComboByName.mockResolvedValue({ name: "dead", models: ["bai/dead-a", "bai/dead-b"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [
        { id: "dead-a", availability: "unavailable" },
        { id: "dead-b", availability: "unavailable" },
      ]),
    ]);
    expect(await getComboModels("dead")).toEqual(["bai/dead-a", "bai/dead-b"]);
  });

  it("never returns an empty array — callers test truthiness, and [] is truthy", async () => {
    getComboByName.mockResolvedValue({ name: "dead", models: ["alitp-intl/qwen3.8-max-preview"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("alitp-intl", [{ id: "qwen3.8-max", availability: "available" }]),
    ]);
    const members = await getComboModels("dead");
    expect(members).not.toEqual([]);
    expect(members.length).toBeGreaterThan(0);
  });

  it("still strips a member when at least one other remains routable", async () => {
    getComboByName.mockResolvedValue({ name: "mix", models: ["bai/gone", "bai/live"] });
    getProviderConnections.mockResolvedValue([
      catalogConn("bai", [
        { id: "gone", availability: "unavailable" },
        { id: "live", availability: "available" },
      ]),
    ]);
    expect(await getComboModels("mix")).toEqual(["bai/live"]);
  });
});

describe("circuit breaker is scoped per model, not per account", () => {
  // Upstream locks modelLock_${model}. An account-wide breaker let a bad model
  // take every other model on the same account down with it — inside a combo
  // that silently removes the fallback the user configured.
  it("does not block a healthy model after another model on the same account trips", () => {
    const badModel = buildAccountBreakerName({
      provider: "openrouter",
      connectionId: "conn-1",
      model: "model-a",
    });
    const goodModel = buildAccountBreakerName({
      provider: "openrouter",
      connectionId: "conn-1",
      model: "model-b",
    });
    expect(badModel).not.toBe(goodModel);

    getCircuitBreaker(badModel, { failureThreshold: 5, resetTimeout: 30_000 });
    for (let i = 0; i < 5; i++) recordFailure(badModel, { statusCode: 500 });

    expect(isBlocked(badModel)).toBe(true);
    expect(isBlocked(goodModel)).toBe(false);
  });

  it("keys include the model so two models never share a breaker", () => {
    expect(buildAccountBreakerName({ provider: "glm", connectionId: "acc-1", model: "m1" }))
      .toBe("glm:acc-1:m1");
  });
});

describe("per-account concurrency gate is opt-in", () => {
  // Upstream imposes no concurrency cap. A default cap throttled parallel
  // agentic traffic into capacity fallbacks and multi-minute waits.
  it("is bypassed unless the connection configures it", () => {
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: {} })).toBeNull();
    expect(resolveAccountSemaphoreMaxConcurrency(null)).toBeNull();
  });

  it("honours an explicit per-connection limit", () => {
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 2 } })).toBe(2);
  });
});
