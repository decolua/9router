import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// The probe module reaches into the dashboard DB and machine id for auth
// headers; stub both so the scheduler can be tested without a running server.
vi.mock("@/lib/localDb", () => ({ getApiKeys: async () => [{ key: "k", isActive: true }] }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "mid" }));
vi.mock("@/shared/constants/config", () => ({ UPDATER_CONFIG: { appPort: 20128 } }));

const { probeModels, providerOf, resetHeaderCache } = await import(
  "../../src/app/api/models/probe/capabilityProbe.js"
);

describe("provider extraction", () => {
  it("reads the provider segment of a routed id", () => {
    expect(providerOf("openai/gpt-4o")).toBe("openai");
    expect(providerOf("openai-compatible-abc/some-model")).toBe("openai-compatible-abc");
    expect(providerOf("bare-model")).toBe("bare-model");
    expect(providerOf("")).toBe("");
  });
});

describe("probe scheduling", () => {
  let inFlight;
  let peakByProvider;
  let peakGlobal;

  beforeEach(() => {
    resetHeaderCache();
    inFlight = new Map();
    peakByProvider = new Map();
    peakGlobal = 0;

    // Stand in for the gateway: track concurrency, resolve after a tick.
    global.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      const provider = providerOf(body.model);

      const now = (inFlight.get(provider) || 0) + 1;
      inFlight.set(provider, now);
      peakByProvider.set(provider, Math.max(peakByProvider.get(provider) || 0, now));
      const total = [...inFlight.values()].reduce((a, b) => a + b, 0);
      peakGlobal = Math.max(peakGlobal, total);

      await new Promise((r) => setTimeout(r, 5));
      inFlight.set(provider, inFlight.get(provider) - 1);

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ choices: [{ message: { content: "ok", tool_calls: [{ id: "1" }] } }] }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one result per model, in input order", async () => {
    const models = ["a/1", "b/2", "a/3"];
    const results = await probeModels(models, { probeVision: false });
    expect(results.map((r) => r.model)).toEqual(models);
  });

  it("caps simultaneous requests to one provider", async () => {
    // 20 models on ONE provider: without a per-provider cap this bursts to the
    // global limit and rate-limits the provider, making good models look broken.
    const models = Array.from({ length: 20 }, (_, i) => `solo/${i}`);
    await probeModels(models, { probeVision: false, concurrency: 32, perProvider: 3 });
    expect(peakByProvider.get("solo")).toBeLessThanOrEqual(3);
  });

  it("still runs many providers at once", async () => {
    // 12 providers x 3 models: the per-provider cap must not throttle the whole
    // sweep down to one provider's worth of throughput.
    const models = [];
    for (let p = 0; p < 12; p += 1) for (let m = 0; m < 3; m += 1) models.push(`p${p}/${m}`);

    await probeModels(models, { probeVision: false, concurrency: 24, perProvider: 2 });
    expect(peakGlobal).toBeGreaterThan(4);
    for (const [, peak] of peakByProvider) expect(peak).toBeLessThanOrEqual(2);
  });

  it("respects the global ceiling", async () => {
    const models = [];
    for (let p = 0; p < 20; p += 1) for (let m = 0; m < 5; m += 1) models.push(`q${p}/${m}`);

    await probeModels(models, { probeVision: false, concurrency: 6, perProvider: 4 });
    expect(peakGlobal).toBeLessThanOrEqual(6);
  });

  it("reports each result as it lands", async () => {
    const seen = [];
    const models = ["a/1", "b/2", "c/3"];
    await probeModels(models, { probeVision: false, onResult: (r) => seen.push(r.model) });
    expect(seen.sort()).toEqual(models.slice().sort());
  });

  it("keeps going when one model throws", async () => {
    global.fetch = vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.model === "bad/one") throw new Error("boom");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      };
    });

    const results = await probeModels(["good/a", "bad/one", "good/b"], { probeVision: false });
    expect(results).toHaveLength(3);
    expect(results[1].ok).toBe(false);
    expect(results[0].ok).toBe(true);
    expect(results[2].ok).toBe(true);
  });

  it("handles an empty list without hanging", async () => {
    await expect(probeModels([], {})).resolves.toEqual([]);
    await expect(probeModels(null, {})).resolves.toEqual([]);
  });

  it("proves tool support only from a real tool_call", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      // Answered in prose — accepted the tools, but never called one.
      text: async () => JSON.stringify({ choices: [{ message: { content: "It is sunny." } }] }),
    }));

    const [result] = await probeModels(["a/1"], { probeVision: false });
    expect(result.ok).toBe(true);
    expect(result.capabilities.tools).toBe(false);
    expect(result.detail.tools).toMatch(/no tool_call/);
  });

  it("classifies throttling apart from failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: "rate limit exceeded" } }),
    }));

    const [result] = await probeModels(["a/1"], { probeVision: false });
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("rate_limited");
  });
});
