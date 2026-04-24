// Patch global fetch with proxy support (must be first)
import "./utils/proxyFetch";

// Config
export { PROVIDERS, type ProviderConfig } from "./config/providers";
export { OAUTH_ENDPOINTS, CLAUDE_SYSTEM_PROMPT } from "./config/appConstants";
export { CACHE_TTL, DEFAULT_MAX_TOKENS, COOLDOWN_MS, BACKOFF_CONFIG } from "./config/runtimeConfig";
export { 
  PROVIDER_MODELS, 
  getProviderModels,
  getDefaultModel, 
  isValidModel,
  findModelName,
  getModelTargetFormat,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
  type ModelEntry
} from "./config/providerModels";

// Translator
export { FORMATS } from "./translator/formats";
export { 
  register, 
  translateRequest, 
  translateResponse, 
  needsTranslation, 
  initState, 
  initTranslators 
} from "./translator/index";

// Services
export { 
  detectFormat, 
  getProviderConfig, 
  buildProviderUrl, 
  buildProviderHeaders, 
  getTargetFormat 
} from "./services/provider";

export { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "./services/model";

export {
  checkFallbackError,
  isAccountUnavailable,
  getUnavailableUntil,
  filterAvailableAccounts
} from "./services/accountFallback";

export {
  TOKEN_EXPIRY_BUFFER_MS,
  refreshAccessToken,
  refreshClaudeOAuthToken,
  refreshGoogleToken,
  refreshQwenToken,
  refreshCodexToken,
  refreshIflowToken,
  refreshGitHubToken,
  refreshCopilotToken,
  getAccessToken,
  refreshTokenByProvider
} from "./services/tokenRefresh";

// Handlers
export { handleChatCore, isTokenExpiringSoon } from "./handlers/chatCore";
export { createStreamController, pipeWithDisconnect, createDisconnectAwareStream } from "./utils/streamHandler";

// Executors
export { getExecutor, hasSpecializedExecutor } from "./executors/index";

// Utils
export { errorResponse, formatProviderError } from "./utils/error";
export { 
  createSSETransformStreamWithLogger, 
  createPassthroughStreamWithLogger 
} from "./utils/stream";
