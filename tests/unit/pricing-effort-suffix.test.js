// Regression: usage rows keep the effort-annotated model id ("gpt-6.1-sol(xhigh)").
// getPricingForModel resolved that id verbatim — missing the base model's exact
// entry and falling through to a broader glob or to null ($0). The variant must
// price at its base model's rate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;

// The DB adapter is a process-wide singleton (global._dbAdapter), so the whole
// file shares one DATA_DIR — set it once in beforeAll and use distinct model
// ids per case so user-pricing writes don't leak between assertions.
let tempDir;
let pricingRepo;
let usageRepo;
let constPricing;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pricing-suffix-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  pricingRepo = await import("@/lib/db/repos/pricingRepo.js");
  usageRepo = await import("@/lib/db/repos/usageRepo.js");
  constPricing = await import("open-sse/providers/pricing.js");
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("getPricingForModel effort-suffix resolution", () => {
  it("(1) prices an annotated codex model at its base model rate", async () => {
    const base = await pricingRepo.getPricingForModel("codex", "gpt-6.1-sol");
    const annotated = await pricingRepo.getPricingForModel("codex", "gpt-6.1-sol(xhigh)");
    expect(annotated).not.toBeNull();
    expect(annotated).toEqual(base);
  });

  it("(2) annotated id does not fall through to a broader glob", async () => {
    // gpt-5.6-sol(xhigh) matches the gpt-5.6-* glob (input 2.50) but must price
    // at the exact gpt-5.6-sol entry (input 5.00).
    const base = await pricingRepo.getPricingForModel("codex", "gpt-5.6-sol");
    const annotated = await pricingRepo.getPricingForModel("codex", "gpt-5.6-sol(xhigh)");
    expect(annotated).toEqual(base);
    expect(annotated.input).toBe(5.00);
  });

  it("(3) a user override on the base id applies to the annotated id", async () => {
    const override = { input: 9.99, output: 99.99 };
    await pricingRepo.updatePricing({ codex: { "gpt-6.1-sol": override } });
    expect(await pricingRepo.getPricingForModel("codex", "gpt-6.1-sol(xhigh)")).toEqual(override);
  });

  it("(4) a user override on the exact annotated id wins over the base override", async () => {
    const baseOverride = { input: 8.88, output: 88.88 };
    const exactOverride = { input: 1.11, output: 11.11 };
    await pricingRepo.updatePricing({
      codex: { "gpt-6-sol": baseOverride, "gpt-6-sol(max)": exactOverride },
    });
    expect(await pricingRepo.getPricingForModel("codex", "gpt-6-sol(max)")).toEqual(exactOverride);
  });

  it("(5) an un-annotated id resolves identically to the constants table", async () => {
    // gpt-5.6-sol / claude-sonnet-4-5 / gpt-6-luna carry no user overrides here.
    for (const model of ["gpt-5.6-sol", "claude-sonnet-4-5", "gpt-6-luna"]) {
      expect(await pricingRepo.getPricingForModel("codex", model))
        .toEqual(constPricing.getPricingForModel("codex", model));
    }
  });

  it("(6) saved usage for an annotated id stores the base model's cost", async () => {
    const tokens = { prompt_tokens: 1000, completion_tokens: 500 };
    await usageRepo.saveRequestUsage({
      timestamp: "2026-10-07T00:00:00.000Z",
      provider: "codex", model: "gpt-6-luna", tokens, status: "ok",
    });
    await usageRepo.saveRequestUsage({
      timestamp: "2026-10-07T00:00:01.000Z",
      provider: "codex", model: "gpt-6-luna(max)", tokens, status: "ok",
    });

    const rows = await usageRepo.getUsageHistory();
    const baseRow = rows.find((r) => r.model === "gpt-6-luna");
    const annotatedRow = rows.find((r) => r.model === "gpt-6-luna(max)");
    expect(baseRow).toBeTruthy();
    expect(annotatedRow).toBeTruthy();
    expect(annotatedRow.cost).toBeGreaterThan(0);
    expect(annotatedRow.cost).toBeCloseTo(baseRow.cost, 10);
  });
});
