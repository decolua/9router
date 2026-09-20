import { getCustomModels, getProviderNodes } from "@/lib/localDb";
import { getModelInfo } from "@/sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { getModelType } from "open-sse/config/providerModels.js";
import { AUTO_ROUTING_STRATEGY, validateAutoRouting } from "open-sse/config/autoRouting.js";

export async function validateAutoRoutingStrategies(strategies) {
  if (!strategies || typeof strategies !== "object" || Array.isArray(strategies)) return "comboStrategies must be an object";
  const configs = [];
  for (const [name, strategy] of Object.entries(strategies)) {
    if (strategy?.fallbackStrategy !== AUTO_ROUTING_STRATEGY && !strategy?.autoRouting) continue;
    const error = validateAutoRouting(strategy.autoRouting);
    if (error) return `${name}: ${error}`;
    configs.push(strategy.autoRouting);
  }
  if (!configs.length) return null;
  const [nodes, customModels] = await Promise.all([getProviderNodes(), getCustomModels()]);
  const models = new Set(configs.flatMap((config) => [config.classifierModel, ...Object.values(config.tiers).flat()]));
  for (const model of models) {
    const resolved = await getModelInfo(model);
    const provider = REGISTRY.find((entry) => entry.id === resolved.provider);
    const node = nodes.find((entry) => entry.id === resolved.provider);
    if (!provider && !node) return `Unknown provider for ${model}`;
    if (provider && !(provider.serviceKinds || ["llm"]).includes("llm")) return `${model} is not an LLM`;
    if (node && !["openai-compatible", "anthropic-compatible"].includes(node.type)) return `${model} is not an LLM`;
    const prefix = model.slice(0, model.indexOf("/"));
    const custom = customModels.find((entry) => entry.providerAlias === prefix && entry.id === resolved.model);
    const kind = custom?.kind || custom?.type || getModelType(resolved.provider, resolved.model);
    if (kind && kind !== "llm") return `${model} is not an LLM`;
  }
  return null;
}
