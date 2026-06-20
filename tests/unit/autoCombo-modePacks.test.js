import { describe, it, expect } from "vitest";
import { MODE_PACKS, getModePack, getModePackNames } from "../../open-sse/services/autoCombo/modePacks.js";
import { validateWeights } from "../../open-sse/services/autoCombo/scoring.js";

describe("autoCombo modePacks", () => {
  it("every mode pack's weights sum to 1.0 (±0.01)", () => {
    for (const [name, weights] of Object.entries(MODE_PACKS)) {
      expect(validateWeights(weights), `${name} did not sum to 1.0`).toBe(true);
    }
  });

  it("getModePack returns the pack by name, undefined when unknown", () => {
    expect(getModePack("ship-fast")).toBe(MODE_PACKS["ship-fast"]);
    expect(getModePack("nope")).toBeUndefined();
  });

  it("getModePackNames lists all 5 packs", () => {
    const names = getModePackNames();
    expect(names).toContain("ship-fast");
    expect(names).toContain("cost-saver");
    expect(names).toContain("quality-first");
    expect(names).toContain("offline-friendly");
    expect(names).toContain("reliability-first");
    expect(names.length).toBe(5);
  });

  it("ship-fast weights latency highest; cost-saver weights cost highest", () => {
    const sf = MODE_PACKS["ship-fast"];
    const cs = MODE_PACKS["cost-saver"];
    expect(Math.max(sf.latencyInv, sf.health)).toBeGreaterThanOrEqual(sf.costInv);
    expect(cs.costInv).toBeGreaterThan(cs.latencyInv);
  });
});
