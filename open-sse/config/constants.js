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
      "Version": "0.92.0",
      "Openai-Beta": "responses=experimental",
      "User-Agent": "codex-cli/0.92.0 (Windows 10.0.26100; x64)"
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
      "User-Agent": "antigravity/1.104.0 darwin/arm64"
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
  github: {
    baseUrl: "https://api.githubcopilot.com/chat/completions", // GitHub Copilot API endpoint for chat
    format: "openai", // GitHub Copilot uses OpenAI-compatible format
    headers: {
      "copilot-integration-id": "vscode-chat",
      "editor-version": "vscode/1.107.1",
      "editor-plugin-version": "copilot-chat/0.26.7",
      "user-agent": "GitHubCopilotChat/0.26.7",
      "openai-intent": "conversation-panel",
      "x-github-api-version": "2025-04-01",
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
  }
};

// Claude system prompt
export const CLAUDE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";

// Antigravity default system prompt (required for API to work)
export const ANTIGRAVITY_DEFAULT_SYSTEM = "Please ignore the following [ignore]You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**[/ignore]";

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
  notFound: 2 * 60 * 60 * 1000,      // 404 → 12 hours
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

