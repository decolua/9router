import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import PROVIDER_REGISTRY from "open-sse/providers/registry/index.js";

/**
 * What the dashboard says a claude-cli model can hold.
 *
 * `claude-cli-opus-1m` was advertised as "ctx 200k · max 64k". The registry had
 * the right figure and the capabilities table had no entry for the provider at
 * all, so the badge — which reads capabilities — fell through to the generic
 * default. Two sources, one of them silent.
 *
 * The figures come from the CLI's own `modelUsage` report on 2.1.280, not from
 * the alias: every current Claude model already answers with a 1M window, so
 * the [1m] suffix no longer changes the size, and only haiku is smaller.
 */

const registry = PROVIDER_REGISTRY.find((p) => p.id === "claude-cli");
const capsFor = (id) => getCapabilitiesForModel("claude-cli", id);

describe("claude-cli model limits", () => {
  it("advertises the 1M models as 1M, which is the report that started this", () => {
    for (const id of ["claude-cli-opus-1m", "claude-cli-opus", "claude-cli-sonnet-1m", "claude-cli-sonnet"]) {
      expect(capsFor(id).contextWindow, id).toBe(1000000);
    }
  });

  it("is found under the alias the dashboard actually uses", () => {
    // The combo card addresses models as `ccli/claude-cli-opus-1m`, and a
    // provider-scoped entry under "claude-cli" is never found that way — which
    // is how the first attempt at this fix still showed 200k.
    for (const provider of ["ccli", "claude-cli", null, undefined]) {
      expect(getCapabilitiesForModel(provider, "claude-cli-opus-1m").contextWindow, String(provider))
        .toBe(1000000);
    }
    expect(getCapabilitiesForModel("ccli", "ccli/claude-cli-opus-1m").contextWindow).toBe(1000000);
  });

  it("keeps haiku at its real, smaller window", () => {
    expect(capsFor("claude-cli-haiku").contextWindow).toBe(200000);
    expect(capsFor("claude-cli-haiku").maxOutput).toBe(32000);
  });

  it("gives opus the larger output ceiling the CLI reports for it", () => {
    expect(capsFor("claude-cli-opus-1m").maxOutput).toBe(128000);
    expect(capsFor("claude-cli-sonnet").maxOutput).toBe(64000);
  });

  it("marks every model as taking images and reasoning, because the CLI does", () => {
    for (const model of registry.models) {
      const caps = capsFor(model.id);
      expect(caps.vision, model.id).toBe(true);
      expect(caps.reasoning, model.id).toBe(true);
    }
  });

  it("agrees with the registry, so the two screens cannot disagree", () => {
    // The provider page reads the registry and the combo badge reads
    // capabilities. One of them being silently wrong is how this was missed.
    for (const model of registry.models) {
      if (model.id === "claude-cli-default") continue; // depends on the account
      expect(capsFor(model.id).contextWindow, model.id).toBe(model.contextLength);
    }
  });

  it("says nothing specific about the account's own default, because it cannot know", () => {
    // Whatever `claude` is configured to use locally; a number here would be a
    // guess dressed as a fact.
    expect(capsFor("claude-cli-default").contextWindow).toBe(200000);
  });
});
