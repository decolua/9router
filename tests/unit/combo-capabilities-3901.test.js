// #3901 — combo entries in GET /v1/models carried no `capabilities` object at
// all, while every single-provider entry declares one. Codex CLI reads that
// field to decide what tool schema to send, so a combo made it downgrade to two
// stub tools with empty `parameters.properties` — the model was handed nothing
// it could actually call, and nothing reported an error.

import { describe, it, expect } from "vitest";

import {
  comboCapabilities,
  COMBO_REPORTED_CAPABILITIES,
} from "../../open-sse/services/comboCapabilities.js";

// Stand-in for getCapabilitiesForModel: a table keyed by member reference.
const table = (rows) => (ref) => rows[ref];

describe("comboCapabilities (#3901)", () => {
  it("declares a feature every member has", () => {
    const caps = comboCapabilities(
      ["cu/grok", "ag/gemini"],
      table({
        "cu/grok": { tools: true, vision: true },
        "ag/gemini": { tools: true, vision: true },
      }),
    );
    expect(caps.tools).toBe(true);
    expect(caps.vision).toBe(true);
  });

  it("withholds a feature one member lacks, even when the others have it", () => {
    // This is the whole point. Reordering by capability fit does not drop a
    // member, so fallback can still land on the one without tools; promising
    // `tools: true` because the first member has them breaks exactly there,
    // silently, on the turn a tool is needed.
    const caps = comboCapabilities(
      ["cu/grok", "kr/text-only"],
      table({
        "cu/grok": { tools: true, vision: true },
        "kr/text-only": { tools: false, vision: false },
      }),
    );
    expect(caps.tools).toBe(false);
    expect(caps.vision).toBe(false);
  });

  it("treats a missing member record as not supporting the feature", () => {
    // capsFor is getCapabilitiesForModel in production, which always answers —
    // an unknown model gets DEFAULT_CAPABILITIES rather than undefined. If the
    // lookup ever does come back empty, the pool must not inherit an optimistic
    // true from its other members.
    const caps = comboCapabilities(
      ["cu/grok", "zz/unknown"],
      table({ "cu/grok": { tools: true } }),
    );
    expect(caps.tools).toBe(false);
  });

  it("reports each flag independently", () => {
    const caps = comboCapabilities(
      ["a/one", "b/two"],
      table({
        "a/one": { tools: true, vision: true, reasoning: false },
        "b/two": { tools: true, vision: false, reasoning: false },
      }),
    );
    expect(caps.tools).toBe(true);
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
  });

  it("returns null for a combo with no usable members", () => {
    // An absent `capabilities` is what the bug looked like, so it must only
    // happen when there is genuinely nothing to report — never as a silent
    // fallback for a combo that does have members.
    expect(comboCapabilities([], table({}))).toBe(null);
    expect(comboCapabilities(null, table({}))).toBe(null);
    expect(comboCapabilities(["", "   "], table({}))).toBe(null);
  });

  it("reports the flags a client reads, and not the per-model wire details", () => {
    const caps = comboCapabilities(["a/one"], table({ "a/one": { tools: true } }));
    expect(Object.keys(caps).sort()).toEqual([...COMBO_REPORTED_CAPABILITIES].sort());
    // thinkingFormat, thinkingRange, contextWindow and maxOutput describe how to
    // talk to one specific model; merged across a pool they would be wrong
    // rather than merely incomplete.
    for (const field of ["thinkingFormat", "thinkingRange", "contextWindow", "maxOutput"]) {
      expect(caps).not.toHaveProperty(field);
    }
  });
});
