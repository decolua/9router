// tests/unit/pricing-resolve.test.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;
let resolveRoute;
let pricingRoute;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  resolveRoute = await import("../../src/app/api/pricing/resolve/route.js");
  pricingRoute = await import("../../src/app/api/pricing/route.js");
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const post = (body) => resolveRoute.POST(new Request("http://localhost/api/pricing/resolve", { method: "POST", body: JSON.stringify(body) }));

describe("resolvePricingForModel", () => {
  it("override beats built-in, and resetting restores the built-in source", async () => {
    expect((await db.resolvePricingForModel("gemini", "unpriced-test-model")).source).toBe("none");
    await db.updatePricing({ gemini: { "unpriced-test-model": { input: 0.1, output: 0.4 } } });
    const r = await db.resolvePricingForModel("gemini", "unpriced-test-model");
    expect(r.source).toBe("override");
    expect(r.pricing.input).toBe(0.1);
    await db.resetPricing("gemini", "unpriced-test-model");
    expect((await db.resolvePricingForModel("gemini", "unpriced-test-model")).source).toBe("none");
  });
  it("an override on a built-in priced model replaces its price and reports override", async () => {
    await db.updatePricing({ gemini: { "gemini-4-argon": { input: 3, output: 15 } } });
    const r = await db.resolvePricingForModel("gemini", "gemini-4-argon");
    expect(r.source).toBe("override");
    expect(r.pricing.input).toBe(3);
  });
});

describe("POST /api/pricing/resolve", () => {
  it("returns the price and source for each requested model", async () => {
    const res = await post({ provider: "gemini", models: ["gemini-4-argon", "unpriced-test-model"] });
    expect(res.status).toBe(200);
    const { prices } = await res.json();
    expect(prices["gemini-4-argon"].source).toBe("pattern");
    expect(prices["unpriced-test-model"]).toEqual({ pricing: null, source: "none" });
  });
  it.each([
    [{}], [{ provider: "gemini" }], [{ provider: "gemini", models: "x" }],
    [{ provider: 5, models: ["a"] }], [{ provider: "gemini", models: Array(501).fill("a") }],
  ])("rejects %j with 400", async (body) => {
    expect((await post(body)).status).toBe(400);
  });
  it("sees an override written through the existing PATCH route", async () => {
    await pricingRoute.PATCH(new Request("http://localhost/api/pricing", {
      method: "PATCH", body: JSON.stringify({ gemini: { "unpriced-test-model": { input: 0.1, output: 0.4 } } }),
    }));
    const { prices } = await (await post({ provider: "gemini", models: ["unpriced-test-model"] })).json();
    expect(prices["unpriced-test-model"].source).toBe("override");
  });
});
