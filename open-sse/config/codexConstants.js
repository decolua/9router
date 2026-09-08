// Shared outbound identity for discovery, chat, images and connection probes.
export const CODEX_CLIENT_VERSION = "0.153.4";
export const CODEX_USER_AGENT = `codex_cli_rs/${CODEX_CLIENT_VERSION}`;

export const CODEX_IMAGE_NO_RESULT_ERROR = "Codex completed without returning an image.";
export const CODEX_IMAGE_ERROR_TEXT_LIMIT = 1000;

export const CODEX_AUTO_PING_MODEL = "gpt-5.6-luna";

// Explicit, image-only compatibility policy. No model is rewritten by default.
export function resolveCodexImageModel(model, raw = process.env.CODEX_IMAGE_MODEL_ALIASES) {
  if (!raw) return model;
  let aliases;
  try { aliases = JSON.parse(raw); } catch { throw new Error("CODEX_IMAGE_MODEL_ALIASES must be a JSON object"); }
  const validId = /^[a-zA-Z0-9][a-zA-Z0-9._-]*-image$/;
  if (!aliases || Array.isArray(aliases) || typeof aliases !== "object" ||
      Object.entries(aliases).some(([from, to]) => !validId.test(from) || typeof to !== "string" || !validId.test(to))) {
    throw new Error("CODEX_IMAGE_MODEL_ALIASES must map image model IDs to image model IDs");
  }
  return Object.hasOwn(aliases, model) ? aliases[model] : model;
}
