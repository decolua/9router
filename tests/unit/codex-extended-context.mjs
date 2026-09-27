import assert from "node:assert/strict";
import codex from "../../open-sse/providers/registry/codex.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { stripModelContextMarker } from "../../open-sse/utils/modelMarkers.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

for (const id of ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
  const extended = `${id}[1m]`;
  assert.equal(codex.models.find((model) => model.id === extended)?.upstreamModelId, id);
  assert.equal(getModelUpstreamId("cx", extended), id);
  assert.equal(getCapabilitiesForModel("codex", extended).contextWindow, 872000);
  assert.equal(getCapabilitiesForModel("cx", extended).contextWindow, 872000);
  assert.deepEqual(stripModelContextMarker(`cx/${extended}`), { model: `cx/${id}`, contextMarker: "1m" });
}
const unsupported = "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.";
assert.equal(checkFallbackError(400, unsupported, 0, "codex").shouldFallback, true);
assert.equal(checkFallbackError(400, "Invalid JSON body", 0, "codex").shouldFallback, false);
console.log("Codex extended models and account fallback OK");
