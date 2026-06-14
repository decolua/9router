import { describe, it, expect, beforeEach } from "vitest";

import {
  getRotatedModels,
  handleComboChat,
  resetComboRotation,
} from "../../open-sse/services/combo.js";

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

function okResponse(model) {
  return new Response(JSON.stringify({ ok: true, model }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function failResponse(status, message = "rate limited") {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

describe("combo round-robin pointer after fallback hop", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("advances past the model that actually served the request (not the originally-selected one)", async () => {
    // models: [a, b, c]  index starts at 2 (c)
    // req 1: rotation selects c → c fails → b fallback → b succeeds (i=1 in rotated=[c,a,b])
    //        fix must advance pointer past b (absolute index 1) → next = c (idx 2)
    //        WITHOUT fix: pointer would land on a (idx 0 = currentIndex+1=3%3=0)
    const models = ["provider/model-a", "provider/model-b", "provider/model-c"];

    // Force pointer to index=2 by calling getRotatedModels twice (sticky=1)
    getRotatedModels(models, "test-combo", "round-robin", 1); // index → a (0) → advances to 1
    getRotatedModels(models, "test-combo", "round-robin", 1); // index → b (1) → advances to 2
    // Now state.index = 2 → next rotation starts from c

    const callLog = [];

    // req N: rotation = [c, a, b], c fails, a fails, b succeeds
    await handleComboChat({
      body: {},
      models,
      comboName: "test-combo",
      comboStrategy: "round-robin",
      comboStickyLimit: 1,
      log: silentLog,
      handleSingleModel: async (_body, modelStr) => {
        callLog.push(modelStr);
        if (modelStr === "provider/model-c") return failResponse(429);
        if (modelStr === "provider/model-a") return failResponse(429);
        return okResponse(modelStr); // b succeeds
      },
    });

    // Without fix: next rotation starts from a (absolute 0 = (2+1)%3)
    // With fix: next rotation starts from c (absolute 2 = (1+1)%3, where b is absolute 1)
    callLog.length = 0;
    await handleComboChat({
      body: {},
      models,
      comboName: "test-combo",
      comboStrategy: "round-robin",
      comboStickyLimit: 1,
      log: silentLog,
      handleSingleModel: async (_body, modelStr) => {
        callLog.push(modelStr);
        return okResponse(modelStr);
      },
    });

    // Next request must start from c (the model after b in the original list)
    expect(callLog[0]).toBe("provider/model-c");
  });

  it("normal path (no fallback) still advances pointer by one", async () => {
    const models = ["provider/model-a", "provider/model-b", "provider/model-c"];
    const firstChoices = [];

    for (let n = 0; n < 3; n++) {
      const callLog = [];
      await handleComboChat({
        body: {},
        models,
        comboName: "test-no-fallback",
        comboStrategy: "round-robin",
        comboStickyLimit: 1,
        log: silentLog,
        handleSingleModel: async (_body, modelStr) => {
          callLog.push(modelStr);
          return okResponse(modelStr);
        },
      });
      firstChoices.push(callLog[0]);
    }

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-c",
    ]);
  });
});
