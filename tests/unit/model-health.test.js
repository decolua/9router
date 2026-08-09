import { beforeEach, describe, expect, it } from "vitest";
import {
  DEMOTION_TTL_MS,
  clearModelHealth,
  demoteUnhealthy,
  isModelDemoted,
  modelFailureCount,
  recordModelFailure,
  recordModelSuccess,
} from "../../open-sse/services/modelHealth.js";

describe("model health tracking", () => {
  beforeEach(() => {
    clearModelHealth();
  });

  it("demotes only after three consecutive failures", () => {
    recordModelFailure("a");
    recordModelFailure("a");
    expect(isModelDemoted("a")).toBe(false);
    recordModelFailure("a");
    expect(isModelDemoted("a")).toBe(true);
  });

  it("clears the run on a success", () => {
    recordModelFailure("b");
    recordModelFailure("b");
    recordModelSuccess("b");
    expect(modelFailureCount("b")).toBe(0);
    recordModelFailure("b");
    expect(isModelDemoted("b")).toBe(false);
  });

  it("counts failures per model independently", () => {
    recordModelFailure("c");
    recordModelFailure("d");
    expect(modelFailureCount("c")).toBe(1);
    expect(modelFailureCount("d")).toBe(1);
  });

  // A demoted model only clears its run by succeeding, and it can only succeed by
  // being tried. While a healthy model sits ahead of it in the cascade and keeps
  // answering, it is never tried — so without a way out it stays demoted forever
  // on the strength of three failures that may be long over.
  it("lets a demoted model back after a quiet spell, with no success to clear it", () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) recordModelFailure("e", t0);
    expect(isModelDemoted("e", undefined, t0)).toBe(true);

    const later = t0 + DEMOTION_TTL_MS + 1;
    expect(isModelDemoted("e", undefined, later)).toBe(false);
    expect(modelFailureCount("e", later)).toBe(0);
  });

  it("re-demotes promptly when the model is still broken after its retry", () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) recordModelFailure("f", t0);

    // Comes back, gets tried, fails again: the run restarts rather than resuming
    // at three, so one stale failure can't re-exile it on its own.
    const later = t0 + DEMOTION_TTL_MS + 1;
    expect(recordModelFailure("f", later)).toBe(1);
    expect(isModelDemoted("f", undefined, later)).toBe(false);
    recordModelFailure("f", later);
    recordModelFailure("f", later);
    expect(isModelDemoted("f", undefined, later)).toBe(true);
  });

  it("keeps a model demoted while failures keep arriving", () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) recordModelFailure("g", t0);
    const nearly = t0 + DEMOTION_TTL_MS - 1;
    expect(isModelDemoted("g", undefined, nearly)).toBe(true);
  });
});

describe("demoteUnhealthy ordering", () => {
  beforeEach(() => {
    clearModelHealth();
  });

  it("moves a sick model to the back and keeps the rest in order", () => {
    for (let i = 0; i < 3; i++) recordModelFailure("m2");
    expect(demoteUnhealthy(["m1", "m2", "m3"])).toEqual(["m1", "m3", "m2"]);
  });

  it("returns the list untouched when everything is healthy", () => {
    const models = ["m1", "m2", "m3"];
    expect(demoteUnhealthy(models)).toBe(models);
  });

  it("never drops a model even when all are sick", () => {
    for (const m of ["m1", "m2"]) for (let i = 0; i < 3; i++) recordModelFailure(m);
    expect(demoteUnhealthy(["m1", "m2"]).sort()).toEqual(["m1", "m2"]);
  });

  it("leaves a single-model combo alone", () => {
    for (let i = 0; i < 3; i++) recordModelFailure("only");
    expect(demoteUnhealthy(["only"])).toEqual(["only"]);
  });
});