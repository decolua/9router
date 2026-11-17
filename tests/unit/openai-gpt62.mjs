import assert from "node:assert/strict";
import { test } from "node:test";
import { getProviderModels, getModelMeta, getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getPricingForModel } from "../../open-sse/providers/pricing.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

// OpenAI API docs: /api/docs/models/gpt-6.2-{sol,astra} and /api/docs/pricing.
// Standard short-context prices, USD per million tokens; not Codex OAuth rates.
for (const [id, name, input, output, cached, cacheCreation] of [
  ["gpt-6.2-sol", "GPT-6.2 Sol", 2, 10, 0.1, 2.5],
  ["gpt-6.2-astra", "GPT-6.2 Astra", 8, 40, 0.4, 10],
]) {
  test(`${id}: public catalog and routing preserve the official API ID`, async () => {
    const models = getProviderModels("openai");
    const matches = models.filter((model) => model.id === id);
    assert.equal(matches.length, 1);
    const [model] = matches; // Real catalog producer, not a hand-built model object.
    assert.equal(model.name, name);
    assert.equal(isValidModel("openai", model.id), true);
    assert.deepEqual(await getModelInfoCore(`openai/${model.id}`), { provider: "openai", model: id });
    assert.deepEqual(await getModelInfoCore(model.id), { provider: "openai", model: id });
    assert.equal(getModelUpstreamId("openai", model.id), id);
    assert.equal(getModelMeta("openai", model.id).responsesLite, undefined);
  });

  test(`${id}: bare API ID does not infer unverified Codex OAuth`, async () => {
    assert.deepEqual(await getModelInfoCore(id), { provider: "openai", model: id });
  });

  test(`${id}: API capabilities cannot disable required reasoning`, () => {
    const caps = getCapabilitiesForModel("openai", id);
    assert.equal(caps.vision, true);
    assert.equal(caps.reasoning, true);
    assert.equal(caps.thinkingFormat, "openai");
    assert.equal(caps.thinkingCanDisable, false);
    assert.equal(caps.contextWindow, 1050000);
    assert.equal(caps.maxOutput, 128000);
    assert.equal(caps.audioInput, false);
    assert.equal(caps.imageOutput, false);
  });

  test(`${id}: thinking picker does not offer rejected none`, () => {
    assert.equal(getThinkingLevels("openai", id).includes("none"), false);
  });

  test(`${id}: thinking wire clamps rejected none`, () => {
    const body = { model: id, reasoning_effort: "none" };
    applyThinking("openai", id, body, "openai");
    assert.equal(body.reasoning_effort, "minimal");
    const neighbor = { model: "gpt-5.4", reasoning_effort: "none" };
    applyThinking("openai", neighbor.model, neighbor, "openai");
    assert.equal(neighbor.reasoning_effort, "none");
  });

  test(`${id}: Standard API pricing is provider scoped`, () => {
    const expected = { input, output, cached, reasoning: output, cache_creation: cacheCreation };
    assert.deepEqual(getPricingForModel("openai", id), expected);
    assert.notDeepEqual(getPricingForModel("codex", id), expected);
    assert.notDeepEqual(getPricingForModel("cx", id), expected);
  });

  test(`${id}: no invented extended variant or OAuth catalog promise`, () => {
    assert.equal(isValidModel("openai", id), true); // Accepted neighbor.
    assert.equal(isValidModel("openai", `${id}[1m]`), false);
    assert.equal(isValidModel("cx", id), false); // Same ID, unverified provider.
    assert.equal(isValidModel("cx", `${id}[1m]`), false);
  });
}

// Mirror the dashboard contract: catalog ID + a level returned by getThinkingLevels.
// Each level is independent so one routing failure cannot hide another scenario.
for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
  const catalogModel = getProviderModels("openai").find((model) => model.id === id);
  const levels = getThinkingLevels("openai", catalogModel.id);
  for (const level of levels) {
    const model = `${catalogModel.id}(${level})`;
    test(`${model}: picker-produced bare suffix preserves API routing and effort`, async () => {
      assert.deepEqual(await getModelInfoCore(model), { provider: "openai", model });
      const body = { model };
      applyThinking("openai", model, body, "openai");
      assert.equal(body.reasoning_effort, level);
      assert.equal(getModelUpstreamId("openai", model), model);
    });
    for (const [prefix, provider] of [["openai", "openai"], ["cx", "codex"], ["codex", "codex"]]) {
      test(`${prefix}/${model}: explicit provider or alias wins over inference`, async () => {
        assert.deepEqual(await getModelInfoCore(`${prefix}/${model}`), { provider, model });
      });
    }
    for (const neighbor of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.2-terra", `${id}[1m]`, `${id}-preview`]) {
      test(`${model}: exact API exception excludes neighbor ${neighbor}(${level})`, async () => {
        // Only the base ID differs; the same legitimate suffix must not widen the exception.
        assert.deepEqual(await getModelInfoCore(model), { provider: "openai", model });
        const neighborModel = `${neighbor}(${level})`;
        assert.deepEqual(await getModelInfoCore(neighborModel), { provider: "codex", model: neighborModel });
      });
    }
  }
}

test("neighboring Codex-only IDs retain existing inference", async () => {
  for (const model of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.2-terra"]) {
    assert.deepEqual(await getModelInfoCore(model), { provider: "codex", model });
  }
  assert.deepEqual(await getModelInfoCore("cx/gpt-6.2-sol"), { provider: "codex", model: "gpt-6.2-sol" });
});
