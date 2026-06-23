// Format identifiers
export const FORMATS = {
  OPENAI: "openai",
  OPENAI_RESPONSES: "openai-responses",
  OPENAI_RESPONSE: "openai-response",
  CLAUDE: "claude",
  GEMINI: "gemini",
  GEMINI_CLI: "gemini-cli",
  VERTEX: "vertex",
  CODEX: "codex",
  ANTIGRAVITY: "antigravity",
  KIRO: "kiro",
  CURSOR: "cursor",
  OLLAMA: "ollama",
  COMMANDCODE: "commandcode",
} as const;

/**
 * Detect source format from request URL pathname + body.
 * Returns null to fall back to body-based detection.
 */
export function detectFormatByEndpoint(
  pathname: string,
  body: { input?: readonly object[] } | null | undefined,
): string | null {
  // /v1/responses is always openai-responses
  if (pathname.includes("/v1/responses")) return FORMATS.OPENAI_RESPONSES;

  // /v1/messages is always Claude
  if (pathname.includes("/v1/messages")) return FORMATS.CLAUDE;

  // /v1/chat/completions + input[] → treat as openai (Cursor CLI sends Responses body via chat endpoint)
  if (pathname.includes("/v1/chat/completions") && Array.isArray(body?.input)) {
    return FORMATS.OPENAI;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Compile-time key-completeness guard
// ---------------------------------------------------------------------------
type KeysEqual<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
type AssertTrue<T extends true> = T;

// Ensure the `as const` object has exactly the expected keys (no drift).
type _FormatsKeysMatch = AssertTrue<
  KeysEqual<
    keyof typeof FORMATS,
    | "OPENAI"
    | "OPENAI_RESPONSES"
    | "OPENAI_RESPONSE"
    | "CLAUDE"
    | "GEMINI"
    | "GEMINI_CLI"
    | "VERTEX"
    | "CODEX"
    | "ANTIGRAVITY"
    | "KIRO"
    | "CURSOR"
    | "OLLAMA"
    | "COMMANDCODE"
  >
>;
