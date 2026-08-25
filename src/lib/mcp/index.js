/**
 * @fileoverview
 * Public API for the 9router MCP subsystem.
 *
 * The gateway lives on top of two independent process-management layers:
 *
 *  - `bridge.js`         Preset stdio plugins (fixed allowlist bundled with
 *                        9router). One child per plugin, spawned on demand.
 *
 *  - `serverManager/`    User-configured MCP servers (remote HTTP, remote SSE,
 *                        or local stdio). Sessions are tracked per server.
 *
 *  - `gateway/`          JSON-RPC handlers exposed at `/api/mcp-gateway/*`.
 *                        Aggregates tools/prompts/resources across every
 *                        active user server and routes calls by prefix.
 *
 * Cross-cutting utilities:
 *
 *  - `protocol.js`       Supported MCP protocol versions + negotiation
 *  - `prefix.js`         Server prefix computation, parsing, and lookup
 *  - `security.js`       Stdio allowlist + spawn resolution + CodeGraph init
 *  - `plugins.js`        Preset stdio plugin registry
 *  - `rateLimit.js`      Sliding-window + token-bucket rate limiter
 *  - `sessionLifetime.js` Reusable session expiry manager
 *
 * External code should import from this barrel rather than reaching into
 * submodules directly.
 */

// ─── Protocol ──────────────────────────────────────────────────────────────

export {
  LATEST_PROTOCOL_VERSION,
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  MAX_BATCH_SIZE,
  isSupportedProtocolVersion,
  negotiateProtocolVersion,
  deriveSessionOwner,
} from "./protocol.js";

// ─── Prefix ────────────────────────────────────────────────────────────────

export {
  computeBasePrefix,
  normalizePrefix,
  makeUniquePrefix,
  getServerPrefix,
  parsePrefixedName,
  stripPrefix,
  findServerByPrefix,
} from "./prefix.js";

// ─── Security ──────────────────────────────────────────────────────────────

export {
  resolveLocalStdioSpawn,
  resolveLocalStdioCommand,
  isAllowedLocalStdioCommand,
  validateLocalStdioServer,
  isCodeGraphServer,
  ensureCodeGraphInitialized,
} from "./security.js";

// ─── Plugin registry ───────────────────────────────────────────────────────

export { findPlugin, listPlugins } from "./plugins.js";

// ─── Rate limiting ─────────────────────────────────────────────────────────

export { checkRateLimit, cleanupRateLimitEntries } from "./rateLimit.js";

// ─── Shared caches / infra ─────────────────────────────────────────────────

export {
  getActiveServersCached,
  invalidateActiveServersCache,
} from "./activeServers.js";
export { getMcpHttpAgent } from "./httpAgent.js";

// ─── Session lifetime ──────────────────────────────────────────────────────

export { SessionLifetimeManager } from "./sessionLifetime.js";

// ─── Preset stdio bridge ───────────────────────────────────────────────────

export {
  getOrSpawn as bridgeGetOrSpawn,
  registerSession as bridgeRegisterSession,
  unregisterSession as bridgeUnregisterSession,
  sendToChild as bridgeSendToChild,
  isRunning as bridgeIsRunning,
  findPlugin as bridgeFindPlugin,
  getStatus as bridgeGetStatus,
} from "./bridge.js";

// ─── User-configured server manager ────────────────────────────────────────

export {
  sendToMcpServer,
  createMcpSSEStream,
  registerGatewaySession,
  unregisterGatewaySession,
  getGatewaySession,
  broadcastGatewayNotification,
  notifyToolsListChanged,
  getServerManagerStatus,
} from "./serverManager/index.js";

// ─── Gateway JSON-RPC handlers ─────────────────────────────────────────────

export {
  invalidateToolsListCache,
  handleToolsList,
  handleToolsCall,
  handlePromptsList,
  handlePromptsGet,
  handleResourcesList,
  handleResourceTemplatesList,
  handleResourcesRead,
  handleCompletionComplete,
} from "./gateway/index.js";
