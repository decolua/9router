// Per-connection upstream API mode for multi-endpoint providers that declare
// `apiModes` in their registry entry (e.g. openai: Chat Completions + Responses
// on the same key). Stored as `providerSpecificData.apiMode` on the connection.
//   auto      → route by client wire format + model family (registry `modelFamilies`)
//   chat      → always POST to the provider's Chat Completions transport
//   responses → always POST to the provider's Responses transport
import { FORMATS } from "../translator/formats.js";

export const API_MODE = Object.freeze({
  AUTO: "auto",
  CHAT: "chat",
  RESPONSES: "responses",
});

// New connections are created with an explicit apiMode, defaulting to auto.
export const API_MODE_DEFAULT = API_MODE.AUTO;
// Connections saved before apiMode existed carry no value: keep their original
// behaviour (Chat Completions only) until the user opts into Auto/Responses.
export const API_MODE_LEGACY_DEFAULT = API_MODE.CHAT;

// Upstream wire format each forced mode pins the request to.
export const API_MODE_FORMAT = Object.freeze({
  [API_MODE.CHAT]: FORMATS.OPENAI,
  [API_MODE.RESPONSES]: FORMATS.OPENAI_RESPONSES,
});

export const API_MODE_LABELS = Object.freeze({
  [API_MODE.AUTO]: "Auto",
  [API_MODE.CHAT]: "Chat",
  [API_MODE.RESPONSES]: "Responses",
});

export const API_MODE_HINTS = Object.freeze({
  [API_MODE.AUTO]: "Responses clients and models that need it (GPT-5.6+, GPT-6) use /v1/responses; everything else uses /v1/chat/completions.",
  [API_MODE.CHAT]: "Always send to /v1/chat/completions (Responses requests are translated).",
  [API_MODE.RESPONSES]: "Always send to /v1/responses (Chat requests are translated).",
});

// Effective mode for a connection of a provider declaring `apiModes`, else null.
// Missing value (pre-existing connection) → legacy default (chat);
// unknown / tampered value → auto so routing never breaks.
export function resolveApiMode(declaredModes, stored) {
  if (!Array.isArray(declaredModes) || !declaredModes.length) return null;
  if (stored === undefined || stored === null || stored === "") {
    return declaredModes.includes(API_MODE_LEGACY_DEFAULT) ? API_MODE_LEGACY_DEFAULT : API_MODE_DEFAULT;
  }
  return declaredModes.includes(stored) ? stored : API_MODE_DEFAULT;
}
