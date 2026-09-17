import { describe, it, expect, beforeEach } from "vitest";

import { getRotatedModels, resetComboRotation, handleComboChat } from "../../open-sse/services/combo.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });
});

// ── Combo failure reporting ────────────────────────────────────────────────
// Regression: the final response paired the FIRST member's status with the LAST
// member's message. A combo whose first member returned 403 therefore answered
// 403, which reads as "the 403 was propagated and the chain died" even though
// every member had been tried.
describe("handleComboChat failure reporting", () => {
  const log = { info: () => {}, warn: () => {}, error: () => {} };

  const failing = (status, message) => new Response(
    JSON.stringify({ error: { message } }),
    { status, headers: { "Content-Type": "application/json" } },
  );

  it("reports the status of the same failure its message came from", async () => {
    const tried = [];
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openrouter/qwen", "deepseek/chat"],
      handleSingleModel: async (_body, modelStr) => {
        tried.push(modelStr);
        return modelStr === "openrouter/qwen"
          ? failing(403, "no access to this model")
          : failing(503, "provider overloaded");
      },
      log,
      comboName: "test-combo",
      comboStrategy: "none",
    });

    expect(tried, "every member must be tried").toEqual(["openrouter/qwen", "deepseek/chat"]);
    // 403 here would be the first member's status paired with the second's message.
    expect(response.status).toBe(503);

    const body = await response.json();
    const message = body?.error?.message || body?.error || "";
    expect(message).toContain("provider overloaded");
    expect(message, "the trail must show the fallback really ran").toContain("openrouter/qwen:403");
    expect(message).toContain("deepseek/chat:503");
  });

  it("leaves a single-member failure message untouched", async () => {
    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["openrouter/qwen"],
      handleSingleModel: async () => failing(403, "no access to this model"),
      log,
      comboName: "solo-combo",
      comboStrategy: "none",
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    const message = body?.error?.message || body?.error || "";
    expect(message).toBe("no access to this model");
  });
});
