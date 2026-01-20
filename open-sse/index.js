// Patch global fetch with proxy support (must be first)
import "./utils/proxyFetch.js";

// Config
export { PROVIDERS, OAUTH_ENDPOINTS, CACHE_TTL, DEFAULT_MAX_TOKENS, CLAUDE_SYSTEM_PROMPT, COOLDOWN_MS, BACKOFF_CONFIG } from "./config/constants.js";
export { 
  PROVIDER_MODELS, 
  getProviderModels,
  getDefaultModel, 
  isValidModel,
  findModelName,
  getModelTargetFormat,
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId
} from "./config/providerModels.js";

// Translator
export { FORMATS } from "./translator/formats.js";
export { 
  register, 
  translateRequest, 
  translateResponse, 
  needsTranslation, 
  initState, 
  initTranslators 
} from "./translator/index.js";

// Services
export { 
  detectFormat, 
  getProviderConfig, 
  buildProviderUrl, 
  buildProviderHeaders, 
  getTargetFormat 
} from "./services/provider.js";

export { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "./services/model.js";

export {
  checkFallbackError,
  isAccountUnavailable,
  getUnavailableUntil,
  filterAvailableAccounts
} from "./services/accountFallback.js";

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
} from "./services/tokenRefresh.js";

// Handlers
export { handleChatCore, isTokenExpiringSoon } from "./handlers/chatCore.js";
export { createStreamController, pipeWithDisconnect, createDisconnectAwareStream } from "./utils/streamHandler.js";

// Utils
export { errorResponse, formatProviderError } from "./utils/error.js";
export { 
  createSSETransformStreamWithLogger, 
  createPassthroughStreamWithLogger 
} from "./utils/stream.js";
