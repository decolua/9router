import { describe, expect, it, beforeEach } from "vitest";

// The incident, 2026-08-25. `openrouter/stealth/ox-alpha` has no entry in the
// static capability table, so it inherited DEFAULT_CAPABILITIES.vision = false.
// A Claude Code session attached one screenshot; reorderByCapabilities promoted
// a 200K vision member over the 1M head, compactCeiling dropped from 838,860 to
// 160,000, the gateway 413'd, and the client auto-compacted for nothing. The
// OpenRouter catalogue had said input_modalities ["text","image","video"] all
// along, and a direct probe confirmed the model reads images correctly.
const { __setForTests, observeModalities, learnedModalities } = await import(
  "../../open-sse/services/modalityRegistry.js"
);
const { getCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");

// Never empty: an empty cache makes learnedModalities kick off a lazy DB prime,
// which is not what any of these cases are about.
const seed = (entries = []) =>
  __setForTests(new Map([["test/placeholder", { vision: false }], ...entries]));

describe("a learned modality fills the gap the static table leaves", () => {
  beforeEach(() => seed());

  it("a model nobody has named is blind by default — the bug", () => {
    expect(getCapabilitiesForModel("openrouter", "stealth/ox-alpha").vision).toBe(false);
  });

  it("and reads images once the provider's own catalogue says so", () => {
    seed([["openrouter/stealth/ox-alpha", { vision: true, videoInput: true, audioInput: false }]]);
    const caps = getCapabilitiesForModel("openrouter", "stealth/ox-alpha");
    expect(caps.vision).toBe(true);
    expect(caps.videoInput).toBe(true);
    expect(caps.audioInput).toBe(false);
  });

  it("is keyed by the routed id, which is what the combo stores", () => {
    seed([["openrouter/stealth/ox-alpha", { vision: true }]]);
    // The same model asked for under a different provider alias is a different
    // route and must not inherit the answer.
    expect(getCapabilitiesForModel("someone-else", "stealth/ox-alpha").vision).toBe(false);
  });

  it("leaves everything except the input modalities at the floor", () => {
    seed([["openrouter/stealth/ox-alpha", { vision: true }]]);
    const caps = getCapabilitiesForModel("openrouter", "stealth/ox-alpha");
    expect(caps.tools).toBe(true);        // from DEFAULT_CAPABILITIES
    expect(caps.imageOutput).toBe(false); // not an input modality; not learnable here
  });
});

// The half of the precedence that is easy to "tidy up" into a regression.
describe("the static table outranks the catalogue, unlike the window registry", () => {
  beforeEach(() => seed());

  it("keeps ag/claude-sonnet-4-6 blind even when told it sees", () => {
    // Antigravity advertises these as vision-capable. They are declared false on
    // purpose: the executor's Claude branch drops the image and the model then
    // answers from the text alone, confidently and wrongly. Probed 2026-08-23.
    seed([["ag/claude-sonnet-4-6", { vision: true }]]);
    expect(getCapabilitiesForModel("ag", "claude-sonnet-4-6").vision).toBe(false);
  });

  it("keeps ag/claude-opus-4-6-thinking blind too", () => {
    seed([["ag/claude-opus-4-6-thinking", { vision: true }]]);
    expect(getCapabilitiesForModel("ag", "claude-opus-4-6-thinking").vision).toBe(false);
  });

  it("does not override a model a PATTERN already answers for", () => {
    // gemini-* is covered by a pattern; a learned entry must not displace it.
    const before = getCapabilitiesForModel("gemini", "gemini-3.6-flash");
    seed([["gemini/gemini-3.6-flash", { vision: false }]]);
    expect(getCapabilitiesForModel("gemini", "gemini-3.6-flash").vision).toBe(before.vision);
  });
});

describe("observeModalities only records claims it can read", () => {
  beforeEach(() => seed());

  it("ignores a non-object, and a shape with no known flags", async () => {
    expect(await observeModalities("x/y", null)).toBe(false);
    expect(await observeModalities("x/y", { nonsense: true })).toBe(false);
    expect(learnedModalities("x/y")).toBeNull();
  });

  it("ignores a missing model id", async () => {
    expect(await observeModalities("", { vision: true })).toBe(false);
  });
});
