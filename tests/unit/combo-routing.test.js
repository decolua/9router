import { describe, it, expect, beforeEach, vi } from "vitest";

import { getRotatedModels, handleComboChat, resetComboRoutingState } from "../../open-sse/services/combo.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRoutingState();
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


describe("combo model cooldown fallback", () => {
  beforeEach(() => {
    resetComboRoutingState();
  });

  it("skips a rate-limited combo model on the next request", async () => {
    const calls = [];
    const log = { info() {}, warn() {} };
    const handleSingleModel = async (_body, modelStr) => {
      calls.push(modelStr);
      if (modelStr === "provider/model-a") {
        return new Response(JSON.stringify({ error: { message: "FreeUsageLimitError: Rate limit exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const models = ["provider/model-a", "provider/model-b"];

    const first = await handleComboChat({ body: {}, models, handleSingleModel, log, comboName: "Hermes" });
    const second = await handleComboChat({ body: {}, models, handleSingleModel, log, comboName: "Hermes" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
    ]);
  });

  it("skips a model before attempting it when preflight says all accounts are locked", async () => {
    const calls = [];
    const log = { info: vi.fn(), warn: vi.fn() };
    const lockedUntil = new Date(Date.now() + 60_000).toISOString();
    const handleSingleModel = async (_body, modelStr) => {
      calls.push(modelStr);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const response = await handleComboChat({
      body: {},
      models: ["provider/model-a", "provider/model-b"],
      handleSingleModel,
      log,
      comboName: "Hermes",
      preflightModel: async (modelStr) => (
        modelStr === "provider/model-a"
          ? { skip: true, reason: "all accounts locked", retryAfter: lockedUntil, status: 503 }
          : { skip: false }
      ),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(["provider/model-b"]);
    expect(log.warn).toHaveBeenCalledWith(
      "COMBO",
      expect.stringContaining("Skipping model provider/model-a; all accounts locked"),
    );
  });
});
