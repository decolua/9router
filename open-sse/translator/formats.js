// Format identifiers
export const FORMATS = {
  OPENAI: "openai",
  OPENAI_RESPONSES: "openai-responses",
  OPENAI_RESPONSE: "openai-response",
  CLAUDE: "claude",
  GEMINI: "gemini",
  GEMINI_CLI: "gemini-cli",
  CODEX: "codex",
  ANTIGRAVITY: "antigravity",
  KIRO: "kiro",
  CURSOR: "cursor"
};

// Map endpoint suffix → source format (takes priority over body-based detection)
const ENDPOINT_FORMAT_MAP = {
  "/v1/responses": FORMATS.OPENAI_RESPONSES,
  "/v1/chat/completions": FORMATS.OPENAI,
};

/**
 * Detect source format from request URL pathname.
 * Returns null if no matching endpoint found.
 */
export function detectFormatByEndpoint(pathname) {
  for (const [segment, format] of Object.entries(ENDPOINT_FORMAT_MAP)) {
    if (pathname.includes(segment)) return format;
  }
  return null;
}

