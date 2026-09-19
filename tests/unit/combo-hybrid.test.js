import { describe, it, expect, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: () => {}, warn: () => {}, debug: () => {} };

// Minimal OpenAI-chat Response stub with the .ok surface the engine uses. When
// delayMs is set, resolution is delayed so we can control which raced call wins.
function okResponse(content, { delayMs = 0 } = {}) {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, clone: make, json: async () => json, body: null, bodyUsed: false });
  const res = make();
  return delayMs > 0 ? new Promise((r) => setTimeout(() => r(res), delayMs)) : res;
}

function errResponse(status = 500, { delayMs = 0 } = {}) {
  const make = () => ({ ok: false, status, clone: make, json: async () => ({ error: { message: "boom" } }), body: null, bodyUsed: false });
  const res = make();
  return delayMs > 0 ? new Promise((r) => setTimeout(() => r(res), delayMs)) : res;
}

describe("hybrid combo strategy", () => {
  it("races the first two models and returns the faster success", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (_b, model) => {
      seen.push(model);
      if (model === "p/slow") return okResponse("slow", { delayMs: 200 });
      return okResponse(`fast-${model}`, { delayMs: 5 });
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/slow", "p/fast", "p/third"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });

    // Both of the first two were fired in parallel; the third is never reached.
    expect(seen.sort()).toEqual(["p/fast", "p/slow"]);
    const json = await res.clone().json();
    expect(json.choices[0].message.content).toBe("fast-p/fast");
  });

  it("falls back sequentially to the rest only when both raced models fail", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (_b, model) => {
      seen.push(model);
      if (model === "p/a" || model === "p/b") return errResponse(500);
      return okResponse(`ok-${model}`);
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b", "p/c"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });

    // First two raced (both failed), then p/c reached sequentially.
    expect(seen).toContain("p/a");
    expect(seen).toContain("p/b");
    expect(seen).toContain("p/c");
    const json = await res.clone().json();
    expect(json.choices[0].message.content).toBe("ok-p/c");
  });

  it("tries every model then returns an error when all fail", async () => {
    const seen = [];
    const handleSingleModel = vi.fn(async (_b, model) => {
      seen.push(model);
      return errResponse(500);
    });

    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/a", "p/b", "p/c"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });

    // First two raced, then p/c sequentially — all three attempted.
    expect(seen).toContain("p/a");
    expect(seen).toContain("p/b");
    expect(seen).toContain("p/c");
    expect(res.ok).toBe(false);
  });

  it("behaves like plain fallback for a single-model combo", async () => {
    const handleSingleModel = vi.fn(async () => okResponse("solo"));
    const res = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["p/only"],
      handleSingleModel,
      log,
      comboStrategy: "hybrid",
      autoSwitch: false,
    });
    expect(handleSingleModel).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });
});
