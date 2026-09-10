export const GROK_CLI_VERSION = "0.2.99";
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

// Grok CLI models that accept `reasoning.effort`. Kept as an explicit allowlist:
// capabilities.js reports `reasoning: true` for every grok-* model, including
// grok-build and grok-composer-2.5-fast, which reject the field (#2538, #2539).
const GROK_CLI_REASONING_EFFORT_MODELS = /^grok-4\.[56](?:$|-)/;

export function supportsGrokCliReasoningEffort(model) {
  // ponytail: unknown models omit effort until live metadata reaches dispatch.
  return GROK_CLI_REASONING_EFFORT_MODELS.test(String(model || ""));
}
