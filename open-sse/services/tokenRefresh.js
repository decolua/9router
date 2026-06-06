/**
 * Token Refresh barrel — re-exports every public symbol so existing
 * `import { … } from "../services/tokenRefresh.js"` lines keep working.
 *
 * Actual implementations live in:
 *   - ./refresh-dedup.js        (dedupRefresh, constants, error checks)
 *   - ./refresh-providers.js    (per-provider refresh functions)
 *   - ./refresh-vertex.js       (Vertex AI SA JSON + JWT token mint)
 *   - ./refresh-orchestrator.js (routing, formatting, retry)
 */

// ── Dedup, constants, error checks ──────────────────────────────────
export {
  TOKEN_EXPIRY_BUFFER_MS,
  isUnrecoverableRefreshError,
  getRefreshLeadMs,
  classifyOAuthRefreshError,
} from "./refresh-dedup.js";

// ── Provider-specific refresh functions ─────────────────────────────
export {
  refreshXaiToken,
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshKiroToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
} from "./refresh-providers.js";

// ── Vertex AI ───────────────────────────────────────────────────────
export {
  parseVertexSaJson,
  refreshVertexToken,
} from "./refresh-vertex.js";

// ── Orchestration, formatting, retry ────────────────────────────────
export {
  getAccessToken,
  refreshTokenByProvider,
  formatProviderCredentials,
  getAllAccessTokens,
  refreshWithRetry,
} from "./refresh-orchestrator.js";
