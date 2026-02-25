import { platform, arch } from "os";

// === GitHub Copilot Version Constants ===
export const GITHUB_COPILOT = {
  VSCODE_VERSION: "1.110.0",
  COPILOT_CHAT_VERSION: "0.38.0",
  USER_AGENT: "GitHubCopilotChat/0.38.0",
  API_VERSION: "2025-04-01",
};

// === Antigravity Binary Alignment: Numeric Enums ===
// Reference: Antigravity binary analysis - google.internal.cloud.code.v1internal.ClientMetadata

// IDE Type enum (numeric values as expected by Cloud Code API)
export const IDE_TYPE = {
  UNSPECIFIED: 0,
  JETSKI: 10,        // Internal codename for Gemini CLI
  ANTIGRAVITY: 9,
  PLUGINS: 7
};

// Platform enum (as specified in Antigravity binary)
export const PLATFORM = {
  UNSPECIFIED: 0,
  DARWIN_AMD64: 1,
  DARWIN_ARM64: 2,
  LINUX_AMD64: 3,
  LINUX_ARM64: 4,
  WINDOWS_AMD64: 5
};

// Plugin type enum (as specified in Antigravity binary)
export const PLUGIN_TYPE = {
  UNSPECIFIED: 0,
  CLOUD_CODE: 1,
  GEMINI: 2
};

/**
 * Get the platform enum value based on the current OS.
 * @returns {number} Platform enum value
 */
export function getPlatformEnum() {
  const os = platform();
  const architecture = arch();

  if (os === "darwin") {
    return architecture === "arm64" ? PLATFORM.DARWIN_ARM64 : PLATFORM.DARWIN_AMD64;
  } else if (os === "linux") {
    return architecture === "arm64" ? PLATFORM.LINUX_ARM64 : PLATFORM.LINUX_AMD64;
  } else if (os === "win32") {
    return PLATFORM.WINDOWS_AMD64;
  }
  return PLATFORM.UNSPECIFIED;
}

/**
 * Generate platform-specific User-Agent string.
 * @returns {string} User-Agent in format "antigravity/version os/arch"
 */
export function getPlatformUserAgent() {
  const os = platform();
  const architecture = arch();
  return `antigravity/1.104.0 ${os}/${architecture}`;
}

// Centralized client metadata (used in request bodies for loadCodeAssist, onboardUser, etc.)
// Using numeric enum values as expected by the Cloud Code API
export const CLIENT_METADATA = {
  ideType: IDE_TYPE.ANTIGRAVITY,   // 9 - identifies as Antigravity client
  platform: getPlatformEnum(),      // Runtime platform detection
  pluginType: PLUGIN_TYPE.GEMINI    // 2
};

// Internal anti-loop header to identify requests originating from this proxy
export const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// Antigravity headers
export const ANTIGRAVITY_HEADERS = {
  "X-Client-Name": "antigravity",
  "X-Client-Version": "1.107.0",
  "x-goog-api-client": "gl-node/18.18.2 fire/0.8.6 grpc/1.10.x",
  "User-Agent": "antigravity/1.107.0 darwin/arm64"
};

// Cloud Code Assist API endpoints (for Project ID discovery)
export const CLOUD_CODE_API = {
  loadCodeAssist: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  onboardUser: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
};

// Provider configurations
export const PROVIDERS = {
  claude: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,context-management-2025-06-27",
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "User-Agent": "claude-cli/1.0.83 (external, cli)",
      "X-App": "cli",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Runtime-Version": "v24.3.0",
      "X-Stainless-Package-Version": "0.55.1",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": "arm64",
      "X-Stainless-Os": "MacOS",
      "X-Stainless-Timeout": "60"
    },
    // Claude OAuth configuration
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token"
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    format: "gemini",
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: "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"
  },
  "gemini-cli": {
    baseUrl: "https://cloudcode-pa.googleapis.com/v1internal",
    format: "gemini-cli",
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: "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"
  },
  codex: {
    baseUrl: "https://chatgpt.com/backend-api/codex/responses",
    format: "openai-responses", // Use OpenAI Responses API format (reuse translator)
    headers: {
      "originator": "codex-cli",
      "User-Agent": "codex-cli/1.0.18 (macOS; arm64)"
    },
    // OpenAI OAuth configuration
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    clientSecret: "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",
    tokenUrl: "https://auth.openai.com/oauth/token"
  },
  qwen: {
    baseUrl: "https://portal.qwen.ai/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "google-api-nodejs-client/9.15.1",
      "X-Goog-Api-Client": "gl-node/22.17.0"
    },
    // Qwen OAuth configuration
    clientId: "f0304373b74a44d2b584a3fb70ca9e56", // From CLIProxyAPI
    tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token",
    authUrl: "https://chat.qwen.ai/api/v1/oauth2/device/code"
  },
  iflow: {
    baseUrl: "https://apis.iflow.cn/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "iFlow-Cli"
    },
    // iFlow OAuth configuration (from CLIProxyAPI)
    clientId: "10009311001",
    clientSecret: "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
    tokenUrl: "https://iflow.cn/oauth/token",
    authUrl: "https://iflow.cn/oauth"
  },
  antigravity: {
    baseUrls: [
      "https://daily-cloudcode-pa.googleapis.com",
      "https://cloudcode-pa.googleapis.com",
    ],
    format: "antigravity",
    headers: {
      "User-Agent": getPlatformUserAgent()
    },
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    format: "openai",
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy"
    }
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    format: "openai"
  },
  glm: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    }
  },
  "glm-cn": {
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    format: "openai",
    headers: {}
  },
  kimi: {
    baseUrl: "https://api.kimi.com/coding/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    }
  },
  minimax: {
    baseUrl: "https://api.minimax.io/anthropic/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    }
  },
  "minimax-cn": {
    baseUrl: "https://api.minimaxi.com/anthropic/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    }
  },
  github: {
    baseUrl: "https://api.githubcopilot.com/chat/completions", // GitHub Copilot API endpoint for chat
    responsesUrl: "https://api.githubcopilot.com/responses",
    format: "openai", // GitHub Copilot uses OpenAI-compatible format
    headers: {
      "copilot-integration-id": "vscode-chat",
      "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
      "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
      "user-agent": GITHUB_COPILOT.USER_AGENT,
      "openai-intent": "conversation-panel",
      "x-github-api-version": GITHUB_COPILOT.API_VERSION,
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      "Accept": "application/json",
      "Content-Type": "application/json"
    }
  },
  kiro: {
    baseUrl: "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
    format: "kiro",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/vnd.amazon.eventstream",
      "X-Amz-Target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
      "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
      "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0"
    },
    // Kiro OAuth endpoints
    tokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authUrl: "https://prod.us-east-1.auth.desktop.kiro.dev"
  },
  cursor: {
    baseUrl: "https://api2.cursor.sh",
    chatPath: "/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
    format: "cursor",
    headers: {
      "connect-accept-encoding": "gzip",
      "connect-protocol-version": "1",
      "Content-Type": "application/connect+proto",
      "User-Agent": "connect-es/1.6.1"
    },
    clientVersion: "1.1.3"
  },
  "kimi-coding": {
    baseUrl: "https://api.kimi.com/coding/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    },
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token"
  },
  kilocode: {
    baseUrl: "https://api.kilo.ai/api/openrouter/chat/completions",
    format: "openrouter",
    headers: {}
  },
  cline: {
    baseUrl: "https://api.cline.bot/api/v1/messages",
    format: "claude",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
      "Anthropic-Version": "2023-06-01"
    },
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh"
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    format: "openai"
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
    }
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/chat/completions",
    format: "openai"
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    format: "openai"
  },
  xai: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    format: "openai"
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    format: "openai"
  },
  perplexity: {
    baseUrl: "https://api.perplexity.ai/chat/completions",
    format: "openai"
  },
  together: {
    baseUrl: "https://api.together.xyz/v1/chat/completions",
    format: "openai"
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference/v1/chat/completions",
    format: "openai"
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    format: "openai"
  },
  cohere: {
    baseUrl: "https://api.cohere.ai/v1/chat/completions",
    format: "openai"
  },
  nebius: {
    baseUrl: "https://api.studio.nebius.ai/v1/chat/completions",
    format: "openai"
  },
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
    format: "openai"
  },
  hyperbolic: {
    baseUrl: "https://api.hyperbolic.xyz/v1/chat/completions",
    format: "openai"
  },
  deepgram: {
    baseUrl: "https://api.deepgram.com/v1/listen",
    format: "openai"
  },
  assemblyai: {
    baseUrl: "https://api.assemblyai.com/v1/audio/transcriptions",
    format: "openai"
  },
  nanobanana: {
    baseUrl: "https://api.nanobananaapi.ai/v1/chat/completions",
    format: "openai"
  },
  chutes: {
    baseUrl: "https://llm.chutes.ai/v1/chat/completions",
    format: "openai"
  }
};

// Claude system prompt
export const CLAUDE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

// Antigravity default system prompt (required for API to work)
export const ANTIGRAVITY_DEFAULT_SYSTEM = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";

// OAuth endpoints
export const OAUTH_ENDPOINTS = {
  google: {
    token: "https://oauth2.googleapis.com/token",
    auth: "https://accounts.google.com/o/oauth2/auth"
  },
  openai: {
    token: "https://auth.openai.com/oauth/token",
    auth: "https://auth.openai.com/oauth/authorize"
  },
  anthropic: {
    token: "https://console.anthropic.com/v1/oauth/token",
    auth: "https://console.anthropic.com/v1/oauth/authorize"
  },
  qwen: {
    token: "https://chat.qwen.ai/api/v1/oauth2/token", // From CLIProxyAPI
    auth: "https://chat.qwen.ai/api/v1/oauth2/device/code" // From CLIProxyAPI
  },
  iflow: {
    token: "https://iflow.cn/oauth/token",
    auth: "https://iflow.cn/oauth"
  },
  github: {
    token: "https://github.com/login/oauth/access_token",
    auth: "https://github.com/login/oauth/authorize",
    deviceCode: "https://github.com/login/device/code"
  }
};

// Cache TTLs (seconds)
export const CACHE_TTL = {
  userInfo: 300,    // 5 minutes
  modelAlias: 3600  // 1 hour
};

// Default max tokens
export const DEFAULT_MAX_TOKENS = 64000;

// Minimum max tokens for tool calling (to prevent truncated arguments)
export const DEFAULT_MIN_TOKENS = 32000;

// HTTP status codes
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ACCEPTABLE: 406,
  REQUEST_TIMEOUT: 408,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504
};

// OpenAI-compatible error types mapping
export const ERROR_TYPES = {
  [HTTP_STATUS.BAD_REQUEST]: { type: "invalid_request_error", code: "bad_request" },
  [HTTP_STATUS.UNAUTHORIZED]: { type: "authentication_error", code: "invalid_api_key" },
  [HTTP_STATUS.FORBIDDEN]: { type: "permission_error", code: "insufficient_quota" },
  [HTTP_STATUS.NOT_FOUND]: { type: "invalid_request_error", code: "model_not_found" },
  [HTTP_STATUS.NOT_ACCEPTABLE]: { type: "invalid_request_error", code: "model_not_supported" },
  [HTTP_STATUS.RATE_LIMITED]: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  [HTTP_STATUS.SERVER_ERROR]: { type: "server_error", code: "internal_server_error" },
  [HTTP_STATUS.BAD_GATEWAY]: { type: "server_error", code: "bad_gateway" },
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: { type: "server_error", code: "service_unavailable" },
  [HTTP_STATUS.GATEWAY_TIMEOUT]: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code
export const DEFAULT_ERROR_MESSAGES = {
  [HTTP_STATUS.BAD_REQUEST]: "Bad request",
  [HTTP_STATUS.UNAUTHORIZED]: "Invalid API key provided",
  [HTTP_STATUS.FORBIDDEN]: "You exceeded your current quota",
  [HTTP_STATUS.NOT_FOUND]: "Model not found",
  [HTTP_STATUS.NOT_ACCEPTABLE]: "Model not supported",
  [HTTP_STATUS.RATE_LIMITED]: "Rate limit exceeded",
  [HTTP_STATUS.SERVER_ERROR]: "Internal server error",
  [HTTP_STATUS.BAD_GATEWAY]: "Bad gateway - upstream provider error",
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: "Service temporarily unavailable",
  [HTTP_STATUS.GATEWAY_TIMEOUT]: "Gateway timeout"
};

// Exponential backoff config for rate limits (like CLIProxyAPI)
export const BACKOFF_CONFIG = {
  base: 1000,              // 1 second base
  max: 2 * 60 * 1000,      // 2 minutes max
  maxLevel: 15             // Cap backoff level
};

// Error-based cooldown times (aligned with CLIProxyAPI)
export const COOLDOWN_MS = {
  unauthorized: 2 * 60 * 1000,       // 401 → 30 min
  paymentRequired: 2 * 60 * 1000,    // 402/403 → 30 min
  notFound: 2 * 60 * 1000,      // 404 → 2 minutes
  transient: 30 * 1000,               // 408/500/502/503/504 → 1 min
  requestNotAllowed: 5 * 1000,        // "Request not allowed" → 5 sec
  // Legacy aliases for backward compatibility
  rateLimit: 2 * 60 * 1000,
  serviceUnavailable: 2 * 1000,
  authExpired: 2 * 60 * 1000
};

// Skip patterns - requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
  "Please write a 5-10 word title for the following conversation:"
];

