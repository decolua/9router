import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getExecutor } from "../../open-sse/executors/index.js";

// Models the Grok CLI subscription serves that were missing from the static grok-cli list.
// grok-4.6 is advertised by cli-chat-proxy /models; grok-4.7-build-fast and grok-code-fast-1
// are accepted but not advertised, so discovery never surfaces them.
describe("grok-cli static model list", () => {
  const ids = REGISTRY.find((p) => p.id === "grok-cli").models.map((m) => m.id);

  it.each(["grok-4.7-build-fast", "grok-4.6", "grok-code-fast-1"])("lists %s", (id) => {
    expect(ids).toContain(id);
  });

  it("keeps the list free of duplicates", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists no effort-suffixed aliases (the executor strips any suffix into reasoning.effort)", () => {
    expect(ids.filter((id) => /-(low|medium|high|xhigh)$/.test(id))).toEqual([]);
  });

  it("gives build-fast the Grok 4.7 window", () => {
    expect(getCapabilitiesForModel("grok-cli", "grok-4.7-build-fast").contextWindow).toBe(500000);
  });
});

describe("effort suffixes still work without listed aliases", () => {
  const run = (id) => getExecutor("grok-cli").transformRequest(id, { model: id, input: [{ role: "user", content: "hi" }] }, true, {});

  it.each(["low", "medium", "high"])("grok-4.5-%s -> grok-4.5 with that effort", (effort) => {
    const out = run(`grok-4.5-${effort}`);
    expect(out.model).toBe("grok-4.5");
    expect(out.reasoning.effort).toBe(effort);
  });

  it("strips the suffix from models without listed aliases too", () => {
    expect(run("grok-4.7-low").model).toBe("grok-4.7");
  });
});
