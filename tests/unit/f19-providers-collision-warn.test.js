// F19 (audit M11): PROVIDER_MODELS key collision visibility.
// `PROVIDER_MODELS[entry.alias || entry.id]` was last-writer-wins with no signal.
// Policy (see open-sse/providers/index.js): console.warn naming BOTH origins only
// when the colliding normalized lists DIFFER; identical lists (today's real
// mimo-free alias "mmf" vs mmf id "mmf") stay silent. Chosen value never changes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProviderModelMap } from "open-sse/providers/index.js";
import REGISTRY from "open-sse/providers/registry/index.js";

afterEach(() => vi.restoreAllMocks());

function entry(id, alias, models) {
  return alias ? { id, alias, models } : { id, models };
}

describe("buildProviderModelMap — collision warn (different lists)", () => {
  it("warns once naming both origins (id + alias) on key collision", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildProviderModelMap([
      entry("alpha-provider", "ax", [{ id: "m1", name: "M1" }]),
      entry("ax", null, [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }]),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0];
    expect(msg).toContain("PROVIDER_MODELS");
    expect(msg).toContain("ax");
    expect(msg).toContain("alpha-provider");
  });

  it("preserves behavior: last writer still wins, key is NOT renamed", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = buildProviderModelMap([
      entry("alpha-provider", "ax", [{ id: "m1", name: "M1" }]),
      entry("ax", null, [{ id: "m1", name: "M1" }, { id: "m2", name: "M2" }]),
    ]);
    expect(map.ax.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(map["alpha-provider"]).toBeUndefined();
  });

  it("detects collisions regardless of which order the lists differ in", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Same content, different key insertion order in the raw objects → identical
    // after canonical comparison → NO warn (avoid false positives on boot).
    buildProviderModelMap([
      entry("p1", "k", [{ id: "a", name: "A" }]),
      entry("k", null, [{ name: "A", id: "a" }]),
    ]);
    expect(warn).not.toHaveBeenCalled();
    // Same ids, different extra field → real divergence → warn.
    const warn2 = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildProviderModelMap([
      entry("p1", "k", [{ id: "a", name: "A" }]),
      entry("k", null, [{ id: "a", name: "A", context: 128000 }]),
    ]);
    expect(warn2).toHaveBeenCalledTimes(1);
  });
});

describe("buildProviderModelMap — no warn (documented policy)", () => {
  it("stays silent when colliding lists are identical (today's mmf case)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = buildProviderModelMap([
      entry("mimo-free", "mmf", [{ id: "mimo-auto", name: "MiMo Auto" }]),
      entry("mmf", null, [{ id: "mimo-auto", name: "MiMo Auto" }]),
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(map.mmf).toEqual([{ id: "mimo-auto", name: "MiMo Auto" }]);
  });

  it("stays silent when keys are unique", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = buildProviderModelMap([
      entry("one", null, [{ id: "a", name: "A" }]),
      entry("two", "deux", [{ id: "b", name: "B" }]),
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(Object.keys(map)).toEqual(["one", "deux"]);
  });

  it("skips entries without models, like before", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = buildProviderModelMap([entry("no-models", null, undefined)]);
    expect(map).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("real registry: the known mimo-free/mmf collision does NOT warn and keys keep today's shape", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const map = buildProviderModelMap(REGISTRY);
    expect(warn).not.toHaveBeenCalled();
    expect(map.mmf).toEqual([{ id: "mimo-auto", name: "MiMo Auto" }]);
    // No key renames: mimo-free never had its own PROVIDER_MODELS key (routing unchanged).
    expect(map["mimo-free"]).toBeUndefined();
  });
});
