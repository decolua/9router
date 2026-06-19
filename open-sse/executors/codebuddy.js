/**
 * CodeBuddyExecutor — thin shim over DefaultExecutor for www.codebuddy.ai.
 *
 * CodeBuddy's /v2/chat/completions is OpenAI-compatible SSE with two constraints:
 *   1. A `system` message must be present (server returns 11101 without it).
 *   2. `stream: true` is required (non-stream not supported).
 *
 * Constraint #2 is handled by `forceStream: true` in the registry entry.
 * This executor handles #1 by injecting an empty system message when absent.
 *
 * Auth: Bearer ck_* API key (same token also sent as X-API-Key for redundancy,
 * matching the CLI's dual-header pattern).
 */
import { DefaultExecutor } from "./default.js";
import { PROVIDERS } from "../config/providers.js";

const CODEBUDDY_DEFAULT_SYSTEM = {
  role: "system",
  content: "You are a helpful assistant.",
};

function ensureSystemMessage(body) {
  if (!body || typeof body !== "object") return body;
  const messages = body.messages;
  if (!Array.isArray(messages)) return body;
  const hasSystem = messages.some((m) => m.role === "system");
  if (hasSystem) return body;
  return { ...body, messages: [CODEBUDDY_DEFAULT_SYSTEM, ...messages] };
}

export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy");
  }

  transformRequest(model, body, stream, credentials) {
    // Delegate to base transform (json_schema fallback, reasoning injection, etc.)
    const transformed = super.transformRequest(model, body, stream, credentials);
    return ensureSystemMessage(transformed);
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);
    // Match CLI dual-header pattern: Authorization + X-API-Key with the same token.
    // From spike: only Authorization is strictly required, but sending both matches
    // the CLI fingerprint and avoids potential future auth changes.
    const token = credentials?.apiKey || credentials?.accessToken || "";
    if (token && !headers["X-API-Key"]) {
      headers["X-API-Key"] = token;
    }
    return headers;
  }
}
