import { describe, it, expect } from "vitest";
import {
  getUpdaterPhaseLabel,
  getUpdaterProgressPercent,
  getUpdaterStatusUrl,
  isUpdaterFailure,
  isUpdaterSuccess,
} from "../../src/shared/utils/updaterStatus.js";

describe("updaterStatus helpers", () => {
  it("builds local status URL on the configured port", () => {
    expect(getUpdaterStatusUrl(20129)).toBe("http://127.0.0.1:20129/update/status");
    expect(getUpdaterStatusUrl()).toContain("127.0.0.1");
    expect(getUpdaterStatusUrl()).toContain("/update/status");
  });

  it("labels known phases", () => {
    expect(getUpdaterPhaseLabel("starting")).toMatch(/starting/i);
    expect(getUpdaterPhaseLabel("waitingForExit")).toMatch(/stopping/i);
    expect(getUpdaterPhaseLabel("installing", { attempt: 2, maxRetries: 3 })).toMatch(/2\/3/);
    expect(getUpdaterPhaseLabel("done")).toMatch(/complete|restart/i);
    expect(getUpdaterPhaseLabel("error")).toMatch(/failed/i);
  });

  it("maps phases to increasing progress", () => {
    const start = getUpdaterProgressPercent({ phase: "starting" });
    const wait = getUpdaterProgressPercent({ phase: "waitingForExit" });
    const install = getUpdaterProgressPercent({ phase: "installing", attempt: 1, maxRetries: 3 });
    const done = getUpdaterProgressPercent({ phase: "done", done: true, success: true });
    expect(start).toBeLessThan(wait);
    expect(wait).toBeLessThan(install);
    expect(install).toBeLessThan(done);
    expect(done).toBe(100);
  });

  it("detects success and failure terminal states", () => {
    expect(isUpdaterSuccess({ done: true, success: true })).toBe(true);
    expect(isUpdaterSuccess({ done: true, success: false })).toBe(false);
    expect(isUpdaterFailure({ phase: "error" })).toBe(true);
    expect(isUpdaterFailure({ done: true, success: false })).toBe(true);
    expect(isUpdaterFailure({ phase: "installing" })).toBe(false);
  });
});
