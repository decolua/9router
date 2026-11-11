// The Qoder roster advertises a `context_config` list per slot (200K / 400K /
// 1M) while `max_input_tokens` carries only the tier the IDE currently has
// selected. Publishing the selected tier makes every client compact at 200K and
// never send a long request, so the 1M window the provider sells is unreachable
// even though the transport can carry it.
import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { widestQoderContextWindow } from "../../open-sse/shared/qoder/contextTier.js";

describe("qoder published context window", () => {
  it("reports the widest advertised tier, not the selected one", () => {
    const entry = {
      key: "dmodel",
      max_input_tokens: 200_000,
      context_config: ["200K", "400K", "1M"],
    };
    expect(widestQoderContextWindow(entry)).toBe(1_000_000);
  });

  it("falls back to max_input_tokens when the catalog carries no tiers", () => {
    expect(widestQoderContextWindow({ max_input_tokens: 200_000 })).toBe(200_000);
    expect(widestQoderContextWindow({})).toBe(0);
    expect(widestQoderContextWindow(null)).toBe(0);
  });

  it("never reports less than the selected tier", () => {
    // A tier list that omits the selected window must not shrink the model.
    const entry = { max_input_tokens: 400_000, context_config: ["200K"] };
    expect(widestQoderContextWindow(entry)).toBe(400_000);
  });

  it("accepts object-shaped tiers as well as plain strings", () => {
    const entry = { context_config: [{ name: "200K" }, { name: "1M" }] };
    expect(widestQoderContextWindow(entry)).toBe(1_000_000);
  });
});

describe("qoder capability table", () => {
  const models = [
    "auto",
    "fast",
    "efficient",
    "lite",
    "ultimate",
    "performance",
    "qmodel_38max",
    "qmodel_latest",
    "qmodel",
    "qfmodel",
    "kmodel_latest",
    "kmodel",
    "gmodel",
    "gfmodel",
    "dmodel",
    "dfmodel",
    "mmodel",
    "smodel",
    "cmodel",
  ];

  it("publishes the 1M window every roster slot advertises", () => {
    for (const model of models) {
      expect(getCapabilitiesForModel("qoder", model)?.contextWindow, model).toBe(1_000_000);
    }
  });

  it("publishes the same window for the CN deployment", () => {
    expect(getCapabilitiesForModel("qoder-cn", "dmodel")?.contextWindow).toBe(1_000_000);
  });

  it("keeps the per-model output ceilings", () => {
    expect(getCapabilitiesForModel("qoder", "dmodel")?.maxOutput).toBe(65_536);
    expect(getCapabilitiesForModel("qoder", "auto")?.maxOutput).toBe(32_768);
  });
});
