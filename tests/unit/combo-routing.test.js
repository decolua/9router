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

  it("keeps tool requests in priority order even for round-robin combos", async () => {
    const models = ["provider/model-a", "provider/model-b"];
    const tried = [];

    const result = await handleComboChat({
      body: { tools: [{ type: "function", function: { name: "read" } }] },
      models,
      comboName: "code-xhigh",
      comboStrategy: "round-robin",
      comboStickyLimit: 1,
      log: { info() {}, warn() {} },
      handleSingleModel: async (_body, model) => {
        tried.push(model);
        return new Response("ok", { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(tried).toEqual(["provider/model-a"]);

    const secondTried = [];
    await handleComboChat({
      body: { tools: [{ type: "function", function: { name: "read" } }] },
      models,
      comboName: "code-xhigh",
      comboStrategy: "round-robin",
      comboStickyLimit: 1,
      log: { info() {}, warn() {} },
      handleSingleModel: async (_body, model) => {
        secondTried.push(model);
        return new Response("ok", { status: 200 });
      },
    });

    expect(secondTried).toEqual(["provider/model-a"]);
  });

  it("falls back through tool requests with the same request body", async () => {
    const body = { tools: [{ type: "function", function: { name: "read" } }], messages: [{ role: "user", content: "hi" }] };
    const bodies = [];
    const tried = [];

    const result = await handleComboChat({
      body,
      models: ["provider/dead", "provider/live"],
      comboName: "code-xhigh",
      comboStrategy: "round-robin",
      log: { info() {}, warn() {} },
      handleSingleModel: async (passedBody, model) => {
        bodies.push(passedBody);
        tried.push(model);
        return model.endsWith("dead")
          ? new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429, headers: { "content-type": "application/json" } })
          : new Response("ok", { status: 200 });
      },
    });

    expect(result.ok).toBe(true);
    expect(tried).toEqual(["provider/dead", "provider/live"]);
    expect(bodies).toEqual([body, body]);
  });
});
