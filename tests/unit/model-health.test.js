import { beforeEach, describe, expect, it } from "vitest";
import {
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