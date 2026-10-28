// Capacity-adapter picker predicate. A model slot qualifies when either its
// chat capabilities declare the modality (multimodal chat models — caps come
// from the /api/models payload via useModelCaps) or its registered model kind
// maps to it through SERVICE_KIND_CAPABILITIES (typed registry models, e.g.
// groq/whisper-* carries kind "stt" but has no chat-capability entry, so the
// capability table alone left the Audio adapter picker empty — #4638).
import { capabilitiesFromServiceKind } from "open-sse/providers/capabilities.js";

/**
 * @param {string} capFilter adapter capability key ("vision" | "pdf" | "audioInput" | "videoInput")
 * @param {object|null} caps resolved chat capabilities for the model (getCaps result)
 * @param {string|null} modelKind registered model kind/type ("stt" | "tts" | "image" | ...)
 * @returns {boolean}
 */
export function modelSupportsCap(capFilter, caps, modelKind) {
  if (!capFilter) return true;
  if (caps?.[capFilter] === true) return true;
  return capabilitiesFromServiceKind(modelKind)?.[capFilter] === true;
}
