import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const catalogAdditions = [
  { provider: "chutes", id: "Qwen/Qwen3.5-27B-TEE" },
  { provider: "chutes", id: "Qwen/Qwen4-Max" },
  { provider: "chutes", id: "tencent/Hy4" },
  { provider: "minimax-code-global", id: "MiniMax-M3.1-Flash" },
  { provider: "recraft", id: "recraftv4", kind: "image" },
  { provider: "recraft", id: "recraftv4_pro", kind: "image" },
  { provider: "recraft", id: "recraftv4_1", kind: "image" },
  { provider: "recraft", id: "recraftv4_1_pro", kind: "image" },
  { provider: "recraft", id: "recraftv4_1_utility", kind: "image" },
  { provider: "recraft", id: "recraftv4_1_utility_pro", kind: "image" },
  { provider: "recraft", id: "recraftv4_1_flash", kind: "image" },
  { provider: "recraft", id: "recraftv4_1_vector", kind: "image" },
  { provider: "recraft", id: "recraftv4_1_pro_vector", kind: "image" },
  { provider: "recraft", id: "recraftv4_styles", kind: "image" },
  { provider: "recraft", id: "recraftv4_styles_pro", kind: "image" },
  { provider: "runwayml", id: "gen4.5", kind: "video" },
  { provider: "stability-ai", id: "sd3.5-flash", kind: "image" },
  { provider: "voyage-ai", id: "voyage-3", kind: "embedding" },
  { provider: "voyage-ai", id: "voyage-3-lite", kind: "embedding" },
  { provider: "voyage-ai", id: "voyage-large-2-instruct", kind: "embedding" },
  { provider: "voyage-ai", id: "voyage-large-2", kind: "embedding" },
  { provider: "voyage-ai", id: "voyage-2", kind: "embedding" },
];

describe("provider model catalog audit", () => {
  it("exposes every static registry model and resolves its configured upstream ID", () => {
    const issues = [];

    for (const provider of REGISTRY) {
      if (!Array.isArray(provider.models)) continue;

      const alias = provider.alias || provider.id;
      const aliasModels = PROVIDER_MODELS[alias] || [];
      const idModels = PROVIDER_MODELS[provider.id] || [];

      for (const model of provider.models) {
        if (typeof model.id !== "string" || !model.id.trim()) {
          issues.push(`${provider.id}: missing model ID`);
          continue;
        }

        const aliasModel = aliasModels.find((entry) => entry.id === model.id);
        const idModel = idModels.find((entry) => entry.id === model.id);
        if (!aliasModel || !idModel) {
          issues.push(`${provider.id}/${model.id}: missing from registry-backed catalog`);
          continue;
        }

        const expectedUpstreamId = aliasModel.upstreamModelId || aliasModel.id;
        const resolvedUpstreamId = getModelUpstreamId(alias, model.id);
        if (resolvedUpstreamId !== expectedUpstreamId) {
          issues.push(`${provider.id}/${model.id}: expected ${expectedUpstreamId}, resolved ${resolvedUpstreamId}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it.each(catalogAdditions)("exposes $provider model $id with its routed ID and modality", ({ provider, id, kind }) => {
    const model = (PROVIDER_MODELS[provider] || []).find((entry) => entry.id === id);

    expect(model).toBeDefined();
    if (kind) expect(model.kind).toBe(kind);
    expect(getModelUpstreamId(provider, id)).toBe(id);
  });
});
