import { describe, expect, it } from "vitest";
import { matchesProbeFilters, isProbeFilter, needsProbing, PROBE_FILTERS } from "../../src/lib/probe/filters.js";

const probeOf = (over = {}) => ({
  ok: true,
  failureKind: null,
  capabilities: { chat: true, vision: false, tools: false },
  ...over,
});

describe("probe filters", () => {
  it("passes every model when nothing is selected", () => {
    expect(matchesProbeFilters(undefined, new Set())).toBe(true);
    expect(matchesProbeFilters(probeOf(), new Set())).toBe(true);
  });

  it("ignores non-probe filter keys so declared-capability chips still work", () => {
    // "vision"/"free" are handled by the declared-capability path, not here.
    expect(matchesProbeFilters(undefined, new Set(["vision", "free"]))).toBe(true);
  });

  it("rejects an unprobed model for any probe filter", () => {
    for (const { key } of PROBE_FILTERS) {
      expect(matchesProbeFilters(undefined, new Set([key]))).toBe(false);
      expect(matchesProbeFilters(null, new Set([key]))).toBe(false);
    }
  });

  it("matches responding models on probe:ok", () => {
    expect(matchesProbeFilters(probeOf({ ok: true }), new Set(["probe:ok"]))).toBe(true);
    expect(matchesProbeFilters(probeOf({ ok: false }), new Set(["probe:ok"]))).toBe(false);
  });

  it("treats rate-limited models as throttled, not failing", () => {
    const throttled = probeOf({ ok: false, failureKind: "rate_limited" });
    expect(matchesProbeFilters(throttled, new Set(["probe:rate_limited"]))).toBe(true);
    // The whole point of the split: a throttled model is healthy, so it must not
    // show up under "Failing" where the user would delete it.
    expect(matchesProbeFilters(throttled, new Set(["probe:failed"]))).toBe(false);
  });

  it("reports genuine errors under probe:failed", () => {
    const broken = probeOf({ ok: false, failureKind: "error" });
    expect(matchesProbeFilters(broken, new Set(["probe:failed"]))).toBe(true);
    expect(matchesProbeFilters(broken, new Set(["probe:rate_limited"]))).toBe(false);
    expect(matchesProbeFilters(probeOf({ ok: true }), new Set(["probe:failed"]))).toBe(false);
  });

  it("matches measured vision and tool capability", () => {
    const seeing = probeOf({ capabilities: { chat: true, vision: true, tools: false } });
    expect(matchesProbeFilters(seeing, new Set(["probe:vision"]))).toBe(true);
    expect(matchesProbeFilters(seeing, new Set(["probe:tools"]))).toBe(false);
  });

  it("matches measured audio-input capability", () => {
    const hearing = probeOf({ capabilities: { chat: true, audioInput: true } });
    expect(matchesProbeFilters(hearing, new Set(["probe:audio"]))).toBe(true);
    expect(matchesProbeFilters(probeOf(), new Set(["probe:audio"]))).toBe(false);
  });

  it("ANDs audio with other measured capabilities", () => {
    // Filling an audio adapter pool: must respond AND actually accept audio.
    const both = probeOf({ capabilities: { chat: true, vision: true, audioInput: true } });
    const visionOnly = probeOf({ capabilities: { chat: true, vision: true, audioInput: false } });
    const selection = new Set(["probe:ok", "probe:audio"]);

    expect(matchesProbeFilters(both, selection)).toBe(true);
    expect(matchesProbeFilters(visionOnly, selection)).toBe(false);
  });

  it("ANDs multiple probe filters together", () => {
    const both = probeOf({ capabilities: { chat: true, vision: true, tools: true } });
    const visionOnly = probeOf({ capabilities: { chat: true, vision: true, tools: false } });
    const selection = new Set(["probe:ok", "probe:vision", "probe:tools"]);

    expect(matchesProbeFilters(both, selection)).toBe(true);
    // Satisfies two of three — must be excluded, not included.
    expect(matchesProbeFilters(visionOnly, selection)).toBe(false);
  });

  it("ANDs probe filters with an unsatisfiable combination", () => {
    // ok and failed are mutually exclusive by construction.
    expect(matchesProbeFilters(probeOf({ ok: true }), new Set(["probe:ok", "probe:failed"]))).toBe(false);
  });

  it("recognises only probe-namespaced keys", () => {
    expect(isProbeFilter("probe:ok")).toBe(true);
    expect(isProbeFilter("vision")).toBe(false);
    expect(isProbeFilter("probe:nope")).toBe(false);
  });
});

describe("re-probe decision", () => {
  const ok = { ok: true, stale: false, capabilities: { chat: true, vision: true, tools: true, audioInput: false } };

  it("skips a model that already answered", () => {
    expect(needsProbing(ok)).toBe(false);
  });

  it("skips a model that is a settled failure", () => {
    // "Confirmed unusable" needs no more re-testing than "confirmed usable".
    expect(needsProbing({ ok: false, failureKind: "error" })).toBe(false);
    expect(needsProbing({ ok: false, failureKind: "not_found" })).toBe(false);
  });

  it("re-probes a rate-limited model", () => {
    // Throttling says nothing about the model; it may well answer later.
    expect(needsProbing({ ok: false, failureKind: "rate_limited" })).toBe(true);
  });

  it("re-probes failures about the credential or the network, not the model", () => {
    // A fixed key or a better connection makes these pass, so treating them as
    // settled would strand a working model.
    expect(needsProbing({ ok: false, failureKind: "auth" })).toBe(true);
    expect(needsProbing({ ok: false, failureKind: "timeout" })).toBe(true);
  });

  it("re-probes a model that has never been measured", () => {
    expect(needsProbing(undefined)).toBe(true);
    expect(needsProbing(null)).toBe(true);
  });

  it("re-probes a stale verdict, settled or not", () => {
    expect(needsProbing({ ...ok, stale: true })).toBe(true);
    expect(needsProbing({ ok: false, failureKind: "error", stale: true })).toBe(true);
  });

  it("re-probes a success that predates audio when audio is requested", () => {
    const noAudioVerdict = { ok: true, stale: false, capabilities: { chat: true } };
    expect(needsProbing(noAudioVerdict, { probeAudio: true })).toBe(true);
    expect(needsProbing(noAudioVerdict, { probeAudio: false })).toBe(false);
  });

  it("does not re-probe for audio when a verdict already exists", () => {
    expect(needsProbing(ok, { probeAudio: true })).toBe(false);
  });

  it("leaves a settled failure alone even when audio is requested", () => {
    // The model does not work at all, so its audio support is moot.
    expect(needsProbing({ ok: false, failureKind: "error" }, { probeAudio: true })).toBe(false);
  });
});
