import { describe, it, expect, beforeEach } from "vitest";
import {
  getRotatedModels,
  recordComboLatency,
  getComboLatency,
  resetComboLatency,
  handleComboChat,
  COMBO_FAILURE_LATENCY_MS,
} from "../../open-sse/services/combo.js";

// #5083: "fastest" combo strategy orders members by measured latency.
const log = { info() {}, warn() {}, debug() {}, error() {} };
const ok = (text = "hi") =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const fail = () => new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500, headers: { "Content-Type": "application/json" } });

describe("fastest combo strategy", () => {
  beforeEach(() => resetComboLatency());

  it("keeps configured order while nothing is measured", () => {
    expect(getRotatedModels(["a/1", "b/2", "c/3"], "c", "fastest")).toEqual(["a/1", "b/2", "c/3"]);
  });

  it("puts unmeasured first, then measured fastest first, never drops a member", () => {
    recordComboLatency("a/1", 900);
    recordComboLatency("c/3", 100);
    expect(getRotatedModels(["a/1", "b/2", "c/3"], "c", "fastest")).toEqual(["b/2", "c/3", "a/1"]);
  });

  it("smooths samples instead of jumping on one outlier", () => {
    recordComboLatency("a/1", 100);
    recordComboLatency("a/1", 1100);
    expect(getComboLatency("a/1")).toBe(400);
  });

  it("does not affect other strategies", () => {
    recordComboLatency("b/2", 1);
    expect(getRotatedModels(["a/1", "b/2"], "c", "fallback")).toEqual(["a/1", "b/2"]);
  });

  it("measures the winner and penalises a failing member through handleComboChat", async () => {
    const calls = [];
    const handleSingleModel = async (_b, m) => {
      calls.push(m);
      if (m === "slow/x") return fail();
      await new Promise((r) => setTimeout(r, 5));
      return ok();
    };
    const body = { messages: [{ role: "user", content: "hi" }] };
    const res = await handleComboChat({ body, models: ["slow/x", "fast/y"], handleSingleModel, log, comboName: "f", comboStrategy: "fastest", autoSwitch: false });
    expect(res.status).toBe(200);
    expect(getComboLatency("slow/x")).toBe(COMBO_FAILURE_LATENCY_MS);
    expect(getComboLatency("fast/y")).toBeGreaterThanOrEqual(4);
    expect(getComboLatency("fast/y")).toBeLessThan(COMBO_FAILURE_LATENCY_MS);

    calls.length = 0;
    await handleComboChat({ body, models: ["slow/x", "fast/y"], handleSingleModel, log, comboName: "f", comboStrategy: "fastest", autoSwitch: false });
    expect(calls[0]).toBe("fast/y");
  });

  it("records nothing for non-fastest strategies", async () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    await handleComboChat({ body, models: ["a/1", "b/2"], handleSingleModel: async () => ok(), log, comboName: "g", comboStrategy: "fallback", autoSwitch: false });
    expect(getComboLatency("a/1")).toBeUndefined();
  });
});
