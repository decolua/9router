export const OPENAI_COMPATIBLE_API_TYPES = Object.freeze({
  AUTO: "auto",
  CHAT: "chat",
  RESPONSES: "responses",
});

export const OPENAI_COMPATIBLE_API_TYPE_OPTIONS = Object.freeze([
  { value: OPENAI_COMPATIBLE_API_TYPES.AUTO, label: "Match Client API" },
  { value: OPENAI_COMPATIBLE_API_TYPES.CHAT, label: "Chat Completions" },
  { value: OPENAI_COMPATIBLE_API_TYPES.RESPONSES, label: "Responses API" },
]);

export const OPENAI_COMPATIBLE_DEFAULT_API_TYPE = OPENAI_COMPATIBLE_API_TYPES.CHAT;
export const OPENAI_COMPATIBLE_CLI_DEFAULT_API_TYPE = OPENAI_COMPATIBLE_API_TYPES.AUTO;

const OPENAI_COMPATIBLE_API_TYPE_SET = new Set(
  Object.values(OPENAI_COMPATIBLE_API_TYPES),
);

export function isOpenAICompatibleApiType(value) {
  return OPENAI_COMPATIBLE_API_TYPE_SET.has(value);
}
