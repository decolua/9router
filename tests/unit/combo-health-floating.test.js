import { describe, it, expect, beforeEach } from "vitest";
import {
  reorderByHealth,
  isModelInCooldown,
  markModelCooldown,
  clearModelCooldown,
  resetAllModelCooldowns,
  extractCooldownMs,
  handleComboChat
} from "../../open-sse/services/combo.js";

describe("combo health-aware floating", () => {
  beforeEach(() => {
    resetAllModelCooldowns();
  });

  it("floats locked models to the end while preserving relative canonical order", () => {
    const models = [
      "cc/claude-opus-5-5",
      "cc/claude-sonnet-5",
      "ocg/deepseek-v4-flash",
      "ag/gemini-3.8-flash"
    ];

    const isLocked = (m) => m.startsWith("cc/");
    const reordered = reorderByHealth(models, isLocked);

    expect(reordered).toEqual([
      "ocg/deepseek-v4-flash",
      "ag/gemini-3.8-flash",
      "cc/claude-opus-5-5",
      "cc/claude-sonnet-5"
    ]);
  });

  it("keeps original order when all models are healthy", () => {
    const models = ["model-1", "model-2", "model-3"];
    expect(reorderByHealth(models, () => false)).toEqual(models);
  });

  it("keeps original order when all models are locked", () => {
    const models = ["model-1", "model-2", "model-3"];
    expect(reorderByHealth(models, () => true)).toEqual(models);
  });

  it("correctly tracks and clears cooldowns", () => {
    expect(isModelInCooldown("provider/model-a")).toBe(false);

    markModelCooldown("provider/model-a", 5000);
    expect(isModelInCooldown("provider/model-a")).toBe(true);

    clearModelCooldown("provider/model-a");
    expect(isModelInCooldown("provider/model-a")).toBe(false);
  });

  it("extracts cooldown duration from human-readable reset string", () => {
    const errorText = "[claude/claude-sonnet-5] Unavailable (reset after 3m 40s)";
    const ms = extractCooldownMs(null, null, errorText);
    expect(ms).toBe((3 * 60 + 40) * 1000); // 220000 ms
  });

  it("extracts cooldown duration from retryAfter ISO date", () => {
    const targetDate = new Date(Date.now() + 120000).toISOString();
    const ms = extractCooldownMs(null, { retryAfter: targetDate }, "");
    expect(ms).toBeGreaterThan(110000);
    expect(ms).toBeLessThanOrEqual(120000);
  });

  it("automatically demotes failing model to tail on subsequent request, and restores when healthy", async () => {
    const models = ["model-failing", "model-working"];
    const callLog = [];

    const mockHandler = async (body, modelStr) => {
      callLog.push(modelStr);
      if (modelStr === "model-failing") {
        return new Response(JSON.stringify({ error: { message: "rate limited (reset after 5m)" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ content: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const mockLog = {
      info: () => {},
      warn: () => {},
      error: () => {}
    };

    // 1st request: tries model-failing, fails with 429, falls over to model-working (succeeds)
    callLog.length = 0;
    const res1 = await handleComboChat({
      body: { messages: [] },
      models,
      handleSingleModel: mockHandler,
      log: mockLog
    });
    expect(res1.ok).toBe(true);
    expect(callLog).toEqual(["model-failing", "model-working"]);
    expect(isModelInCooldown("model-failing")).toBe(true);

    // 2nd request: model-failing is in cooldown! Should be floated to end, calling model-working FIRST!
    callLog.length = 0;
    const res2 = await handleComboChat({
      body: { messages: [] },
      models,
      handleSingleModel: mockHandler,
      log: mockLog
    });
    expect(res2.ok).toBe(true);
    expect(callLog).toEqual(["model-working"]); // Only called model-working! Zero calls to model-failing!

    // Cooldown reset / expired: model-failing recovers its original spot!
    clearModelCooldown("model-failing");
    callLog.length = 0;
    const res3 = await handleComboChat({
      body: { messages: [] },
      models,
      handleSingleModel: mockHandler,
      log: mockLog
    });
    expect(res3.ok).toBe(true);
    expect(callLog).toEqual(["model-failing", "model-working"]);
  });
});
