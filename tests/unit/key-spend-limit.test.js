// tests/unit/key-spend-limit.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const svc = await import("../../src/sse/services/keySpendLimit.js");

const NOW = new Date("2026-11-24T20:30:00.000Z");
const priced = { getCombos: async () => [], resolveModel: async (e) => ({ provider: "openai", model: e }), getPricing: async () => ({ input: 1 }) };
const unpriced = { ...priced, getPricing: async () => null };

function entry(over = {}) {
  return {
    keyValue: "sk-a", name: "agent-a",
    access: { restricted: true, allow: ["gpt-4"] },
    limit: { usd: 10, window: "day" },
    ...over,
  };
}
const ctx = (...limits) => ({ keyName: "agent-a", endpoint: "/v1/chat/completions", limits });
const deps = (spent, pricing = priced) => ({ ...pricing, getSpend: vi.fn(async () => spent) });

beforeEach(() => svc.resetSpendCache());

describe("checkSpendLimit", () => {
  it("no limits on the context -> allowed, no DB read", async () => {
    const d = deps(0);
    expect(await svc.checkSpendLimit(ctx(), d, NOW)).toBeNull();
    expect(d.getSpend).not.toHaveBeenCalled();
  });
  it("below the cap -> allowed", async () => {
    expect(await svc.checkSpendLimit(ctx(entry()), deps(9.99), NOW)).toBeNull();
  });
  it("at or above the cap -> 429 with Retry-After and the reset time", async () => {
    const res = await svc.checkSpendLimit(ctx(entry()), deps(10), NOW);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("daily cost limit of $10");
    expect(JSON.stringify(body)).toContain("2026-11-25T00:00:00.000Z");
    expect(JSON.stringify(body)).not.toContain("agent-a"); // never names the key
  });
  it("logs one self-explanatory line per refusal: 429, key name, spent, cap, window, reset, endpoint, no key value", async () => {
    const log = await import("@/sse/utils/logger.js");
    log.warn.mockClear();
    await svc.checkSpendLimit(ctx(entry({ limit: { usd: 0.01, window: "day" } })), deps(0.0125), NOW);
    const lines = log.warn.mock.calls.map((c) => `[${c[0]}] ${c[1]}`).filter((l) => l.includes("key-spend-limit"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('[AUTH] key-spend-limit: REFUSED 429 · key "agent-a" · spent $0.0125 of $0.01 per day · resets 2026-11-25T00:00:00.000Z · /v1/chat/completions');
    expect(lines[0]).not.toContain("sk-a");
  });
  it("uses Anthropic's error envelope on /v1/messages", async () => {
    const c = { ...ctx(entry()), endpoint: "/v1/messages" };
    const res = await svc.checkSpendLimit(c, deps(50), NOW);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("rate_limit_error");
  });
  it("asks the DB for the window start of the right window", async () => {
    const d = deps(0);
    await svc.checkSpendLimit(ctx(entry({ limit: { usd: 5, window: "month" } })), d, NOW);
    expect(d.getSpend).toHaveBeenCalledWith("sk-a", "2026-11-01T00:00:00.000Z");
  });
  it("a limit on a key that can reach an unpriced model is NOT enforced", async () => {
    const d = deps(1000, unpriced);
    expect(await svc.checkSpendLimit(ctx(entry()), d, NOW)).toBeNull();
    expect(d.getSpend).not.toHaveBeenCalled();
  });
  it("an unrestricted key's limit is not enforced (ineligible)", async () => {
    const e = entry({ access: { restricted: false, allow: [] } });
    expect(await svc.checkSpendLimit(ctx(e), deps(1000), NOW)).toBeNull();
  });
  it("fails open when the spend read throws", async () => {
    const d = { ...priced, getSpend: vi.fn(async () => { throw new Error("db locked"); }) };
    expect(await svc.checkSpendLimit(ctx(entry()), d, NOW)).toBeNull();
  });
  it("any presented limited key over its cap denies the request", async () => {
    const e2 = entry({ keyValue: "sk-b", name: "agent-b" });
    const d = { ...priced, getSpend: vi.fn(async (k) => (k === "sk-b" ? 99 : 1)) };
    const res = await svc.checkSpendLimit(ctx(entry(), e2), d, NOW);
    expect(res.status).toBe(429);
  });
  it("caches spend per key and window for the TTL, then asks again", async () => {
    const d = deps(1);
    await svc.checkSpendLimit(ctx(entry()), d, NOW);
    await svc.checkSpendLimit(ctx(entry()), d, new Date(NOW.getTime() + 4000));
    expect(d.getSpend).toHaveBeenCalledTimes(1);
    await svc.checkSpendLimit(ctx(entry()), d, new Date(NOW.getTime() + 6000));
    expect(d.getSpend).toHaveBeenCalledTimes(2);
  });
});

describe("getLimitStatus", () => {
  it("reports eligibility, unpriced models and (when a limit is set) spend and reset", async () => {
    const eligible = await svc.getLimitStatus({ access: { restricted: true, allow: ["gpt-4"] }, limit: { usd: 10, window: "day" }, key: "sk-a" }, deps(4.5), NOW);
    expect(eligible).toEqual({ eligible: true, unbounded: false, unpriced: [], effective: true, spentUsd: 4.5, resetsAt: "2026-11-25T00:00:00.000Z" });

    const disabled = await svc.getLimitStatus({ access: { restricted: true, allow: ["gpt-4"] }, limit: { usd: 10, window: "day" }, key: "sk-a" }, deps(4.5, unpriced), NOW);
    expect(disabled.effective).toBe(false);
    expect(disabled.unpriced).toEqual(["openai/gpt-4"]);

    const noLimit = await svc.getLimitStatus({ access: { restricted: false, allow: [] }, limit: null, key: "sk-a" }, deps(0), NOW);
    expect(noLimit).toEqual({ eligible: false, unbounded: true, unpriced: [], effective: false, spentUsd: null, resetsAt: null });
  });
});

describe("gate wiring", () => {
  it("enforceKeyAccess returns 429 for an allowed model once the key is at its cap, and 403 for a denied one first", async () => {
    vi.resetModules();
    vi.doMock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));
    vi.doMock("@/lib/localDb", () => ({
      getModelAliases: async () => ({}),
      getComboByName: async () => null,
      getProviderNodes: async () => [],
    }));
    vi.doMock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
    vi.doMock("@/lib/db/repos/apiKeysRepo.js", () => ({
      getApiKeyByKey: async (k) => (k === "sk-cap"
        ? { id: "k1", name: "capped", isActive: true, access: { restricted: true, allow: ["openai/gpt-4"] }, limit: { usd: 1, window: "day" } }
        : null),
    }));
    vi.doMock("@/lib/db/repos/usageRepo.js", () => ({ getKeySpendSince: async () => 5 }));
    vi.doMock("@/lib/db/repos/pricingRepo.js", () => ({ getPricingForModel: async () => ({ input: 1 }) }));
    const engine = await import("../../src/sse/services/keyAccess.js");
    const req = new Request("http://localhost/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer sk-cap" } });
    const ctx = await engine.getKeyAccessContext(req);
    expect((await engine.enforceKeyAccess(ctx, "openai/gpt-4")).status).toBe(429);
    expect((await engine.enforceKeyAccess(ctx, "openai/other")).status).toBe(403);
  });
});
