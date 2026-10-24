import { FORMATS } from "../../translator/formats.js";
import { getDotHooshLive } from "./dothooshLive.js";

// Codex auto-generates a "-review" variant for each llm model (review quota family)
export const CODEX_REVIEW_SUFFIX = "-review";

export function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review"
      }
    ];
  });
}

export function isMuseSparkModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base);
}

// "model(level)" is a 9router thinking override; strip before matching.
// Accepts both bare ids ("deepseek-v4-pro(max)") and provider-prefixed ones.
export function isDeepSeekModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^deepseek-/i.test(base);
}

// OpenCode Zen free-tier ids all carry the "-free" suffix (e.g.
// "mimo-v2.6-flash-free", "muse-spark-1.3-contributor-free"). Upstream gates
// these behind the attested free-tier identity even on the keyed lane, so the
// executor must detect them to switch auth instead of hardcoding a model list.
export function isOpencodeFreeTierModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /-free$/i.test(base);
}

// Endpoint families for OpenCode models outside the curated registry (modelsFetcher /
// passthrough ids) — regex keeps auto-fetched models on the right endpoint:
// /responses (gpt/grok/muse-spark), /messages (minimax/qwen), /chat/completions (rest).
// Curated registry entries always win; this is the unknown-id fallback only.
const OPENCODE_FAMILIES = [
  { match: /^(grok|gpt|muse[-_]?spark)/i, supportedFormats: [FORMATS.OPENAI_RESPONSES], targetFormat: FORMATS.OPENAI_RESPONSES },
  { match: /^deepseek-v4-(pro|flash)/, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES] },
  { match: /^(minimax|qwen)/, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE] },
  { match: /^claude-/i, supportedFormats: [FORMATS.CLAUDE] },
];

export function opencodeFamilyFormats(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  const base = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  return OPENCODE_FAMILIES.find((f) => f.match.test(base)) || null;
}

// DotHoosh serves every model on one key, but not every model on every lane: Claude only on
// /anthropic/v1/messages, GPT also on /v1/responses, DeepSeek also on the Anthropic lane,
// everything else on Chat Completions. The lanes come from the live listing's protocols[]
// (dothooshLive.js); this family table is only the fallback for ids the listing does not carry.
// First match wins; an id no family claims stays on Chat Completions, which every model supports.
const DOTHOOSH_FAMILIES = [
  { match: /^claude-/i, supportedFormats: [FORMATS.CLAUDE], targetFormat: FORMATS.CLAUDE },
  { match: /^gpt-/i, supportedFormats: [FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES] },
  { match: /^deepseek-/i, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE] },
];

export function dothooshFamilyFormats(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  // The live listing knows which lanes serve a model; the name-based table below only covers
  // ids the listing does not carry (before the first refresh, or a model it dropped).
  const live = getDotHooshLive(modelId);
  if (live) return { supportedFormats: live.supportedFormats, targetFormat: live.targetFormat };
  const base = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  return DOTHOOSH_FAMILIES.find((f) => f.match.test(base)) || { supportedFormats: [FORMATS.OPENAI] };
}
