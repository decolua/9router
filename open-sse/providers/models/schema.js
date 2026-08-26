import { deriveModelName } from "./namePatterns.js";

// Normalize version separators in a model id: hyphen between two digits becomes a dot.
// Registry ids use dots for versions ("claude-sonnet-4.5") but clients (CLIs, aliases)
// often send them with dashes ("claude-sonnet-4-5"). Only digit-digit hyphens are
// touched, so word/suffix hyphens stay intact ("-thinking", "-agentic", "qwen3-coder-next").
export function normalizeModelId(modelId) {
  if (typeof modelId !== "string") return modelId;
  return modelId.replace(/(\d)-(\d)/g, "$1.$2");
}

// Model defaults centralized (was scattered as `m.kind || "llm"`, `quotaFamily || "normal"`, etc.)
export const MODEL_DEFAULTS = {
  kind: "llm",
  quotaFamily: "normal",
  strip: [],
  targetFormat: null
};

// ── Model identity ──────────────────────────────────────────────────────────
// A registry id is a wire name, not a description. `ag/gemini-3.1-pro-low`
// carries three independent facts in one opaque string: the route (`ag`), the
// capability class (`gemini-3.1-pro`) and the declared effort (`low`). The tuner
// used to recover the middle one by substring-searching the whole id, which
// failed in both directions — `-low` inherited the full model's tier, and
// `gemini-pro-agent` matched nothing and became invisible to every combo.
//
// These three fields declare what the id only implies. They are OPTIONAL: a
// model whose id already equals its bench key needs none of them. Declare them
// when the id is a variant, or when the tuner reports the model as unbanded.
//
//   family  Capability class the model belongs to — "gemini-3.1-pro". This is
//           the unit that carries a band; it must match a key in the tuner's
//           bench.models. Unrelated to `quotaFamily`, which groups quota.
//   effort  Declared compute level — "low" | "medium" | "high" | "extra-low" |
//           "minimal" | "max". Shifts the family's band by a declared offset;
//           it never inherits the family's band unchanged.
//   mode    Orthogonal behaviour switch — "thinking", "agentic", "review",
//           "preview", "fast". Documentary only: a mode never moves a band.
//
// A model that is a DIFFERENT model rather than a variant (gpt-5.3-codex-spark
// is not gpt-5.3-codex; gpt-5.5-pro is not gpt-5.5) must not borrow a family.
// Give it a family of its own name and a bench entry to match. A model that is
// not a chat model at all - TTS, image, embedding - declares no family, so it
// can never be ranked as one.
export const MODEL_EFFORTS = ["minimal", "extra-low", "low", "medium", "high", "max"];

export function modelFamily(model) {
  return model?.family || null;
}
export function modelEffort(model) {
  return model?.effort || null;
}
export function modelMode(model) {
  return model?.mode || null;
}

// Normalize a registry model entry: accept terse "id" string, fill name via regex when omitted.
// Override always wins (raw spread last); name falls back to regex → id.
export function normalizeModel(raw) {
  const model = typeof raw === "string" ? { id: raw } : raw;
  if (model.name !== undefined) return model;
  return { ...model, name: deriveModelName(model.id) };
}

// Resolve model kind with default (accepts legacy `type` field)
export function modelKind(model) {
  return model?.kind || model?.type || MODEL_DEFAULTS.kind;
}
export function modelQuotaFamily(model) {
  return model?.quotaFamily || MODEL_DEFAULTS.quotaFamily;
}
export function modelStrip(model) {
  return model?.strip || [];
}
export function modelTargetFormat(model) {
  return model?.targetFormat || MODEL_DEFAULTS.targetFormat;
}

// Per-model declared upstream formats (e.g. ["openai", "claude"]). Guards the
// sourceFormat-matched transport for multi-endpoint providers whose models differ
// in endpoint support (opencode-go: kimi/glm only do /chat/completions, minimax/qwen
// also do /messages, deepseek also does /responses).
export function modelSupportedFormats(model) {
  return model?.supportedFormats || null;
}
