// cli-chat-proxy rejects older identities with HTTP 426. Keep this on a
// current @xai-official/grok release (1.0.44 as of 2026-10-01; minimum 1.0.13).
export const GROK_CLI_VERSION = "1.0.44";
export const GROK_CLI_MODEL = "grok-build";
export const GROK_CLI_BASE_URL = "https://cli-chat-proxy.grok.com/v1";
export const GROK_CLI_CLIENT_IDENTIFIER = "grok-shell";
export const GROK_CLI_USER_AGENT = `grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;
export const GROK_CLI_PAGER_USER_AGENT = `grok-pager/${GROK_CLI_VERSION} grok-shell/${GROK_CLI_VERSION} (linux; x86_64)`;

export function supportsGrokCliReasoningEffort(model) {
  // ponytail: unknown models omit effort until live metadata reaches dispatch.
  return /^grok-4\.5(?:$|-)/.test(String(model || ""));
}
