import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { clearModelCooldowns } from "../../open-sse/services/modelCooldown.js";
import { clearQuotaState } from "../../open-sse/services/quotaState.js";
import { clearModelHealth, isModelDemoted, modelFailureCount, recordModelFailure } from "../../open-sse/services/modelHealth.js";

// Pins the behaviour behind the production line
//   "[COMBO] health demotion → trying nvidia/minimaxai/minimax-m3 first"
// naming a model with a ~5.6% success rate.
//
// demoteUnhealthy's ORDERING is correct (sick models go to the back). The log at
// combo.js:299 fires on a reference comparison (healthOrdered !== rotatedModels),
// and demoteUnhealthy returns a fresh array whenever sick.length > 0 — even when
// the resulting order is byte-identical to the input. So the line is emitted for
// two no-op cases, and in both it names a still-sick model as the new first pick.
//
// It also covers the scoring path for throw-class failures. The cascade's catch
// branch used to record neither success nor failure, so a model failing with
// "200 then the stream ends before the first event" stayed permanently healthy
// and kept its lead position (observed in production: oc/nemotron-3-ultra-free
// at index 0 of Fenrir, failing every request, never demoted). That branch now
// calls recordModelFailure, and the last case here proves such a model reaches
// the threshold and loses first place.

const sick = (m) => { for (let i = 0; i < 3; i++) recordModelFailure(m); };

function capturingLog() {
  const lines = [];
  return { info: (_tag, msg) => lines.push(msg), warn: () => {}, error: () => {}, line: () => {}, lines };
}

const okStream = () =>
  new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });

// 200 + event-stream that closes with no event: preflightSseResponse throws a
// synthetic error carrying comboFallbackStatus = 502 (combo.js:261).
const deadStream = () =>
  new Response(new ReadableStream({ start(c) { c.close(); } }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

const demotionLines = (log) => log.lines.filter((m) => m.startsWith("health demotion"));

describe("[COMBO] health demotion log vs actual reordering", () => {
  beforeEach(() => {
    clearModelCooldowns();
    clearQuotaState();
    clearModelHealth();
  });

  it("logs a demotion naming a sick model when EVERY model is sick (order unchanged)", async () => {
    const models = ["nvidia/minimaxai/minimax-m3", "b/two"];
    models.forEach(sick);
    const tried = [];
    const handleSingleModel = vi.fn(async (_b, m) => { tried.push(m); return okStream(); });
    const log = capturingLog();
    expect(isModelDemoted("nvidia/minimaxai/minimax-m3")).toBe(true); // sick at ordering time

    await handleComboChat({ body: {}, models, handleSingleModel, log, comboName: "c" });

    expect(demotionLines(log)).toEqual(["health demotion → trying nvidia/minimaxai/minimax-m3 first"]);
    expect(tried[0]).toBe("nvidia/minimaxai/minimax-m3");   // nothing moved
  });

  it("logs a demotion when the sick model is ALREADY last (order unchanged)", async () => {
    const models = ["a/well", "b/sick"];
    sick("b/sick");
    const log = capturingLog();

    await handleComboChat({ body: {}, models, handleSingleModel: async () => okStream(), log, comboName: "c" });

    expect(demotionLines(log)).toHaveLength(1);
  });

  it("really does reorder when a sick model leads a healthy one", async () => {
    sick("a/sick");
    const tried = [];
    const handleSingleModel = vi.fn(async (_b, m) => { tried.push(m); return okStream(); });
    const log = capturingLog();

    await handleComboChat({ body: {}, models: ["a/sick", "b/well"], handleSingleModel, log, comboName: "c" });

    expect(demotionLines(log)).toEqual(["health demotion → trying b/well first"]);
    expect(tried[0]).toBe("b/well");
  });

  it("scores a failure when a model returns 200 then an empty stream (preflight 502)", async () => {
    const log = capturingLog();

    await handleComboChat({
      body: {},
      models: ["a/dead", "b/well"],
      handleSingleModel: async (_b, m) => (m === "a/dead" ? deadStream() : okStream()),
      log,
      comboName: "c",
    });

    // The preflight throw carries comboFallbackStatus 502 and lands in the
    // cascade's catch; that branch now scores it, so a model whose failure mode
    // is "200 then dead stream" can reach the demotion threshold like any other.
    expect(modelFailureCount("a/dead")).toBe(1);
  });

  it("scores a failure when handleSingleModel throws", async () => {
    const log = capturingLog();

    await handleComboChat({
      body: {},
      models: ["a/throws", "b/well"],
      handleSingleModel: async (_b, m) => {
        if (m === "a/throws") throw new Error("fetch connect timeout");
        return okStream();
      },
      log,
      comboName: "c",
    });

    expect(modelFailureCount("a/throws")).toBe(1);
  });

  it("demotes a throw-only model after the threshold, so it stops leading the chain", async () => {
    const tried = [];
    const handleSingleModel = async (_b, m) => {
      tried.push(m);
      if (m === "a/dead") throw new Error("stream ended before first event");
      return okStream();
    };

    // Three cascades: each scores one failure against a/dead.
    for (let i = 0; i < 3; i++) {
      await handleComboChat({
        body: {}, models: ["a/dead", "b/well"], handleSingleModel,
        log: capturingLog(), comboName: "c",
      });
    }
    expect(modelFailureCount("a/dead")).toBe(3);
    expect(isModelDemoted("a/dead")).toBe(true);

    // Fourth cascade: a/dead is now sick and must no longer be tried first.
    tried.length = 0;
    await handleComboChat({
      body: {}, models: ["a/dead", "b/well"], handleSingleModel,
      log: capturingLog(), comboName: "c",
    });
    expect(tried[0]).toBe("b/well");
  });

  it("wipes an arbitrarily long failure run on one success (no rate tracking)", async () => {
    for (let i = 0; i < 20; i++) recordModelFailure("a/flaky");
    expect(isModelDemoted("a/flaky")).toBe(true);

    // Single-model combo so the sick model is the one that gets tried; behind a
    // healthy sibling it is never reached and its run would never clear.
    await handleComboChat({
      body: {},
      models: ["a/flaky"],
      handleSingleModel: async () => okStream(),
      log: capturingLog(),
      comboName: "c",
    });

    // 20 failures + 1 success = healthy. 1-in-21 is treated the same as 100%.
    expect(modelFailureCount("a/flaky")).toBe(0);
    expect(isModelDemoted("a/flaky")).toBe(false);
  });
});
