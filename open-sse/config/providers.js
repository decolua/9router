import { platform, arch } from "os";

// === OS/Arch helpers ===
function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

// Shared Claude-compatible API headers (reused across claude-format providers)
const CLAUDE_API_HEADERS = {
  "Anthropic-Version": "2023-06-01",
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

// Shared baseUrls
const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

export const PROVIDERS = {
  claude: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    format: "claude",
    retry: { 429: 0 },
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05",
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "User-Agent": "claude-cli/2.1.63 (external, cli)",
      "X-App": "cli",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Runtime-Version": "v24.3.0",
      "X-Stainless-Package-Version": "0.74.0",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
      "X-Stainless-Arch": mapStainlessArch(),
      "X-Stainless-Os": mapStainlessOs(),
      "X-Stainless-Timeout": "600"
    },
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    tokenUrl: "https://api.anthropic.com/v1/oauth/token"
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
    format: "openai-responses",
    headers: {
      "originator": "codex-cli",
      "User-Agent": "codex-cli/1.0.18 (macOS; arm64)"
    },
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
    clientId: "f0304373b74a44d2b584a3fb70ca9e56",
    tokenUrl: "https://chat.qwen.ai/api/v1/oauth2/token",
    authUrl: "https://chat.qwen.ai/api/v1/oauth2/device/code"
  },
  iflow: {
    baseUrl: "https://apis.iflow.cn/v1/chat/completions",
    format: "openai",
    headers: { "User-Agent": "iFlow-Cli" },
    clientId: "10009311001",
    clientSecret: "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
    tokenUrl: "https://iflow.cn/oauth/token",
    authUrl: "https://iflow.cn/oauth"
  },
  qoder: {
    baseUrl: "https://api.qoder.com/v1/chat/completions",
    format: "openai",
    headers: { "User-Agent": "Qoder-Cli" },
    clientId: process.env.QODER_OAUTH_CLIENT_ID || "10009311001",
    clientSecret: process.env.QODER_OAUTH_CLIENT_SECRET || "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW",
    tokenUrl: "https://api.qoder.com/oauth/token",
    authUrl: "https://qoder.com/oauth/authorize"
  },
  antigravity: {
    baseUrls: [
      "https://daily-cloudcode-pa.googleapis.com",
      "https://daily-cloudcode-pa.sandbox.googleapis.com",
    ],
    format: "antigravity",
    headers: { "User-Agent": `antigravity/1.107.0 ${platform()}/${arch()}` },
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
    headers: { ...CLAUDE_API_HEADERS }
  },
  "glm-cn": {
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    format: "openai",
    headers: {}
  },
  kimi: {
    baseUrl: KIMI_CODING_BASE_URL,
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS }
  },
  minimax: {
    baseUrl: "https://api.minimax.io/anthropic/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS }
  },
  "minimax-cn": {
    baseUrl: "https://api.minimaxi.com/anthropic/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS }
  },
  alicode: {
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
    format: "openai",
    headers: {}
  },
  "alicode-intl": {
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions",
    format: "openai",
    headers: {}
  },
  github: {
    baseUrl: "https://api.githubcopilot.com/chat/completions",
    responsesUrl: "https://api.githubcopilot.com/responses",
    format: "openai",
    headers: {
      "copilot-integration-id": "vscode-chat",
      "editor-version": "vscode/1.110.0",
      "editor-plugin-version": "copilot-chat/0.38.0",
      "user-agent": "GitHubCopilotChat/0.38.0",
      "openai-intent": "conversation-panel",
      "x-github-api-version": "2025-04-01",
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    clientId: "Iv1.b507a08c87ecfe98"
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
    baseUrl: KIMI_CODING_BASE_URL,
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS },
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token"
  },
  kilocode: {
    baseUrl: "https://api.kilo.ai/api/openrouter/chat/completions",
    format: "openai",
    headers: {}
  },
  opencode: {
    baseUrl: "http://localhost:4096/v1/chat/completions",
    format: "openai",
    headers: {}
  },
  cline: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    format: "openai",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline"
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
    headers: { ...CLAUDE_API_HEADERS }
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
  },
  ollama: {
    baseUrl: "https://ollama.com/api/chat",
    format: "ollama"
  },
  "ollama-local": {
    baseUrl: "http://localhost:11434/api/chat",
    format: "ollama"
  },
  // Vertex AI - Gemini models via Service Account JSON
  // baseUrl is not used; VertexExecutor.buildUrl() constructs it dynamically
  vertex: {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "vertex"
  },
  // Vertex AI - Partner models (Claude, Llama, Mistral, GLM) via SA JSON
  // Uses OpenAI-compatible global endpoint (or rawPredict for Anthropic)
  "vertex-partner": {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "openai"
  },
  // GitLab Duo - OpenAI-compatible chat endpoint
  gitlab: {
    baseUrl: "https://gitlab.com/api/v4/chat/completions",
    format: "openai",
  },
  // CodeBuddy (Tencent) - uses device_code polling auth, no chat completions baseUrl needed
  codebuddy: {
    baseUrl: "https://copilot.tencent.com/v1/chat/completions",
    format: "openai",
  },
};
