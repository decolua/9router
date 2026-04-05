import { platform, arch } from "os";

// === Gemini CLI ===
export const GEMINI_CLI_VERSION = "0.31.0";
export const GEMINI_CLI_API_CLIENT = "google-genai-sdk/1.41.0 gl-node/v22.19.0";

export function geminiCLIUserAgent(model = "unknown") {
  const os = platform() === "win32" ? "windows" : platform();
  return `GeminiCLI/${GEMINI_CLI_VERSION}/${model || "unknown"} (${os}; ${arch()})`;
}

// === GitHub Copilot ===
export const GITHUB_COPILOT = {
  VSCODE_VERSION: "1.110.0",
  COPILOT_CHAT_VERSION: "0.38.0",
  USER_AGENT: "GitHubCopilotChat/0.38.0",
  API_VERSION: "2025-04-01",
};

// === Antigravity enums ===
export const IDE_TYPE = {
  UNSPECIFIED: 0,
  JETSKI: 10,
  ANTIGRAVITY: 9,
  PLUGINS: 7
};

export const PLATFORM = {
  UNSPECIFIED: 0,
  DARWIN_AMD64: 1,
  DARWIN_ARM64: 2,
  LINUX_AMD64: 3,
  LINUX_ARM64: 4,
  WINDOWS_AMD64: 5
};

export const PLUGIN_TYPE = {
  UNSPECIFIED: 0,
  CLOUD_CODE: 1,
  GEMINI: 2
};

export function getPlatformEnum() {
  const os = platform();
  const architecture = arch();
  if (os === "darwin") return architecture === "arm64" ? PLATFORM.DARWIN_ARM64 : PLATFORM.DARWIN_AMD64;
  if (os === "linux") return architecture === "arm64" ? PLATFORM.LINUX_ARM64 : PLATFORM.LINUX_AMD64;
  if (os === "win32") return PLATFORM.WINDOWS_AMD64;
  return PLATFORM.UNSPECIFIED;
}

export function getPlatformUserAgent() {
  return `antigravity/1.104.0 ${platform()}/${arch()}`;
}

export const CLIENT_METADATA = {
  ideType: IDE_TYPE.ANTIGRAVITY,
  platform: getPlatformEnum(),
  pluginType: PLUGIN_TYPE.GEMINI
};

// Internal anti-loop header
export const INTERNAL_REQUEST_HEADER = { name: "x-request-source", value: "local" };

// Suffix added to client tools when forwarding to Antigravity provider (anti-ban cloaking)
export const AG_TOOL_SUFFIX = "_ide";

// Suffix added to client tools when forwarding to Claude provider (anti-ban cloaking)
export const CLAUDE_TOOL_SUFFIX = "_ide";

// CC native default tools — these are Claude Code's own tools, kept as decoys
// Client tools matching these names are skipped (not renamed), others get _cc suffix
export const CC_DEFAULT_TOOLS = new Set([
  "Task",
  "TaskOutput",
  "TaskStop",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "Bash",
  "Glob",
  "Grep",
  "Read",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
  "Skill",
  "EnterPlanMode",
  "ExitPlanMode",
]);

// AG native default tools — kept as decoys with neutral description/properties
// These names must match exactly what AG sends in the real request log
export const AG_DEFAULT_TOOLS = new Set([
  "browser_subagent",
  "command_status",
  "find_by_name",
  "generate_image",
  "grep_search",
  "list_dir",
  "list_resources",
  "multi_replace_file_content",
  "notify_user",
  "read_resource",
  "read_terminal",
  "read_url_content",
  "replace_file_content",
  "run_command",
  "search_web",
  "send_command_input",
  "task_boundary",
  "view_content_chunk",
  "view_file",
  "write_to_file"
]);

// Antigravity chat/stream headers
export const ANTIGRAVITY_HEADERS = {
  "User-Agent": `antigravity/1.107.0 ${platform()}/${arch()}`
};

// Cloud Code Assist API
export const CLOUD_CODE_API = {
  loadCodeAssist: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
  onboardUser: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
};

export const LOAD_CODE_ASSIST_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "Client-Metadata": JSON.stringify({ ideType: IDE_TYPE.ANTIGRAVITY, platform: getPlatformEnum(), pluginType: PLUGIN_TYPE.GEMINI }),
};

export const LOAD_CODE_ASSIST_METADATA = {
  ideType: IDE_TYPE.ANTIGRAVITY,
  platform: getPlatformEnum(),
  pluginType: PLUGIN_TYPE.GEMINI,
};

// System prompts
export const CLAUDE_SYSTEM_PROMPT = "You are Claude Code, Anthropic's official CLI for Claude.";
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
    token: "https://api.anthropic.com/v1/oauth/token",
    auth: "https://api.anthropic.com/v1/oauth/authorize"
  },
  qwen: {
    token: "https://chat.qwen.ai/api/v1/oauth2/token",
    auth: "https://chat.qwen.ai/api/v1/oauth2/device/code"
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

// Generate Kimi OAuth custom headers
export function buildKimiHeaders() {
  return {
    "X-Msh-Platform": "9router",
    "X-Msh-Version": "2.1.2",
    "X-Msh-Device-Model": typeof process !== "undefined" ? `${process.platform} ${process.arch}` : "unknown",
    "X-Msh-Device-Id": `kimi-${Date.now()}`
  };
}
