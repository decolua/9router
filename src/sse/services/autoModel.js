import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { buildCapabilityRegistry } from "@/lib/modelRegistry";

const AUTO_PREFIXES = new Set(["auto", "best", "fast", "cheap"]);
const KIND_ALIASES = {
  chat: "llm",
  text: "llm",
  llm: "llm",
  image: "image",
  img: "image",
  video: "video",
  tts: "tts",
  stt: "stt",
  embedding: "embedding",
  embeddings: "embedding",
  "image-to-text": "imageToText",
  imageToText: "imageToText",
  web: "webSearch",
  search: "webSearch",
  fetch: "webFetch",
};

export function parseAutoModel(modelStr, defaultKind = "llm") {
  if (typeof modelStr !== "string") return null;
  const trimmed = modelStr.trim();
  if (!trimmed) return null;
  const [strategy, rawKind] = trimmed.split(":");
  if (!AUTO_PREFIXES.has(strategy)) return null;
  const kind = KIND_ALIASES[rawKind || defaultKind] || rawKind || defaultKind;
  return { strategy, kind, name: rawKind ? `${strategy}:${rawKind}` : strategy };
}

function statusRank(status) {
  if (status === "available") return 0;
  if (status === "untested" || status === "configured" || status === "discoverable") return 1;
  return 9;
}

function scoreModel(model, strategy) {
  const rank = statusRank(model.availability?.status);
  const priority = Number.isFinite(Number(model.priority)) ? Number(model.priority) : 999;
  const sourceRank = model.source === "static" ? 0 : model.source === "provider-config" ? 1 : 2;
  const id = model.id || "";
  let preference = 0;
  if (strategy === "fast" && /flash|turbo|fast|lite|schnell/i.test(id)) preference -= 10;
  if (strategy === "cheap" && /free|lite|mini|flash|schnell/i.test(id)) preference -= 10;
  if (strategy === "best" && /pro|ultra|max|sonnet|opus|gpt-5|gemini-3/i.test(id)) preference -= 10;
  return rank * 10000 + priority * 100 + sourceRank * 10 + preference;
}

export async function getAutoModelCandidates(modelStr, defaultKind = "llm") {
  const parsed = parseAutoModel(modelStr, defaultKind);
  if (!parsed) return null;

  const [connections, combos, customModels, modelAliases, disabledByAlias] = await Promise.all([
    getProviderConnections().catch(() => []),
    getCombos().catch(() => []),
    getCustomModels().catch(() => []),
    getModelAliases().catch(() => ({})),
    getDisabledModels().catch(() => ({})),
  ]);

  const catalog = buildCapabilityRegistry({
    connections,
    combos,
    customModels,
    modelAliases,
    disabledByAlias,
  });

  const viable = catalog
    .filter((model) => model.kind === parsed.kind)
    .filter((model) => statusRank(model.availability?.status) < 9)
    .sort((a, b) => {
      const diff = scoreModel(a, parsed.strategy) - scoreModel(b, parsed.strategy);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });

  return {
    ...parsed,
    models: viable.map((model) => model.id),
    catalog: viable,
  };
}
