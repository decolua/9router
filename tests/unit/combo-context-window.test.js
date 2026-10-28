import { comboContextWindow, comboWindowSetting } from "../../open-sse/providers/capabilities.js";

// A fallback chain does not serve the request with every seat, so the window it can
// promise is the seat that ends up serving it — which is why the operator picks one
// of the seat values rather than an aggregate. These pin the pure resolver.
describe("combo context window", () => {
  const seats = [1000000, 350000, 128000]; // big first seat, smaller middle seat, small tail

  it("defaults to the smallest seat window", () => {
    expect(comboContextWindow(seats, undefined, null)).toBe(128000);
    expect(comboContextWindow(seats, "min", null)).toBe(128000);
  });

  it("pins any value a seat actually has, including one from the middle of the chain", () => {
    expect(comboContextWindow(seats, "custom", 350000)).toBe(350000);
    expect(comboContextWindow(seats, "custom", 1000000)).toBe(1000000);
  });

  it("reports the largest seat for max, which is not necessarily the last seat", () => {
    expect(comboContextWindow([200000, 1000000, 128000], "max", null)).toBe(1000000);
  });

  it("ignores unusable entries and empty chains", () => {
    expect(comboContextWindow([0, NaN, 200000], "min", null)).toBe(200000);
    expect(comboContextWindow([], "custom", 0)).toBeUndefined();
    expect(comboContextWindow([], "min")).toBeUndefined();
    expect(comboContextWindow(null, "max")).toBeUndefined();
  });

  it("reads the per-combo setting and defaults to min for anything unrecognised", () => {
    expect(comboWindowSetting(undefined)).toEqual({ mode: "min", custom: null });
    expect(comboWindowSetting({ fallbackStrategy: "round-robin" })).toEqual({ mode: "min", custom: null });
    expect(comboWindowSetting({ contextWindowMode: "max" })).toEqual({ mode: "max", custom: null });
    expect(comboWindowSetting({ contextWindowMode: "custom", contextWindow: 900000 }))
      .toEqual({ mode: "custom", custom: 900000 });
    expect(comboWindowSetting({ contextWindowMode: "bogus", contextWindow: -5 }))
      .toEqual({ mode: "min", custom: null });
  });
});
