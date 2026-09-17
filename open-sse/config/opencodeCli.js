// OpenCode Free (Zen) client fingerprint, mirrored from opencode-ai 1.18.31.
// The Console rejects a bare "opencode" User-Agent on free-tier models with
// `403 FreeTierError: OpenCode's free tier can only be used from within OpenCode`.
export const OPENCODE_CLI_VERSION = "1.18.31";
export const OPENCODE_AI_SDK_VERSION = "4.0.23";
export const OPENCODE_RUNTIME_VERSION = "1.3.14";
export const OPENCODE_RUNTIME_NAME = "bun";

export const OPENCODE_USER_AGENT =
  `opencode/${OPENCODE_CLI_VERSION} ai-sdk/provider-utils/${OPENCODE_AI_SDK_VERSION} ` +
  `runtime/${OPENCODE_RUNTIME_NAME}/${OPENCODE_RUNTIME_VERSION}`;

export const OPENCODE_DOWNSTREAM_UA_PATTERN = /^opencode\/\d/i;

export const OPENCODE_FREE_TIER_ERROR = "FreeTierError";

export function isAcceptableDownstreamUserAgent(userAgent) {
  return OPENCODE_DOWNSTREAM_UA_PATTERN.test(String(userAgent || "").trim());
}
