import assert from "node:assert/strict";
import { test } from "node:test";
import { getProviderModels, getModelMeta, getModelUpstreamId, isValidModel } from "../../open-sse/config/providerModels.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

for (const [id, name, contextWindow] of [
  ["gpt-6.2-sol", "GPT 6.2 Sol", 500000],
  ["gpt-6.2-astra", "GPT 6.2 Astra", 272000],
]) {
  test(`${id}: Codex discovery preserves default and groups the new family`, () => {
    const models = getProviderModels("cx");
    assert.equal(models[0].id, "gpt-6.1-sol");
    assert.equal(models.filter(model => model.id === id).length, 1);
    const model = models.find(model => model.id === id);
    assert.equal(model.name, name);
    assert.deepEqual(models.slice(1, 3).map(model => model.id), ["gpt-6.2-sol", "gpt-6.2-astra"]);
    assert.equal(getModelUpstreamId("cx", model.id), id);
    assert.equal(getModelMeta("cx", model.id).responsesLite, undefined);
    assert.equal(getModelMeta("cx", model.id).thinkingLevels, undefined);
    assert.equal(isValidModel("cx", model.id), true);
    for (const rejected of [`${id}[1m]`, `${id}-preview`, "gpt-6.2-terra"]) {
      assert.equal(isValidModel("cx", rejected), false);
    }
  });

  for (const provider of ["cx", "codex"]) {
    test(`${provider}/${id}: explicit routing and documented default context`, async () => {
      assert.deepEqual(await getModelInfoCore(`${provider}/${id}`), { provider: "codex", model: id });
      const caps = getCapabilitiesForModel(provider, id);
      const neighbor = getCapabilitiesForModel(provider, "gpt-6-astra");
      assert.deepEqual(caps, { ...neighbor, contextWindow });
      assert.equal(getCapabilitiesForModel("openai", id).contextWindow, 1050000);
    });
    // The picker produces suffixes from the actual catalog and thinking-level resolver.
    for (const level of getThinkingLevels("codex", id)) {
      test(`${provider}/${id}(${level}): picker context does not fall through to API`, () => {
        const caps = getCapabilitiesForModel(provider, `${id}(${level})`);
        assert.equal(caps.contextWindow, contextWindow);
        assert.deepEqual(caps, getCapabilitiesForModel(provider, id));
      });
    }
  }
}

test("OpenAI default and the adjacent pair stay unchanged", () => {
  assert.deepEqual(getProviderModels("openai").slice(0, 3).map(model => model.id), ["gpt-5.5", "gpt-6.2-sol", "gpt-6.2-astra"]);
});
