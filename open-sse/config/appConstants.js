import { platform, arch, hostname } from "os";
import { PROVIDERS, PROVIDER_OAUTH } from "./providers.js";
import { ANTIGRAVITY_IDE_USER_AGENT } from "../providers/shared.js";
import { createRequire } from "module";

// === Gemini CLI === derive từ registry gemini-cli.transport
export const GEMINI_CLI_VERSION = PROVIDERS["gemini-cli"]?.cliVersion;
export const GEMINI_CLI_API_CLIENT = PROVIDERS["gemini-cli"]?.apiClient;

// Map Node arch to Gemini CLI arch string (x64/x86/arm64/...)
function geminiCLIArch() {
  const a = arch();
  if (a === "ia32") return "x86";
  return a;
}

export function geminiCLIUserAgent(model = "unknown") {
  return `GeminiCLI/${GEMINI_CLI_VERSION}/${model || "unknown"} (${platform()}; ${geminiCLIArch()}; terminal)`;
}

// === GitHub Copilot ===
// Derive từ registry github.transport.copilot
const _ghCopilot = PROVIDERS.github?.copilot || {};
export const GITHUB_COPILOT = {
  VSCODE_VERSION: _ghCopilot.vscodeVersion,
  COPILOT_CHAT_VERSION: _ghCopilot.chatVersion,
  USER_AGENT: _ghCopilot.userAgent,
  API_VERSION: _ghCopilot.apiVersion,
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
  return ANTIGRAVITY_IDE_USER_AGENT;
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
  "User-Agent": ANTIGRAVITY_IDE_USER_AGENT
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

// Derive từ registry oauth.refreshLeadMs
export const REFRESH_LEAD_MS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH).filter(([, o]) => o.refreshLeadMs).map(([id, o]) => [id, o.refreshLeadMs])
);

// OAuth endpoints
export const OAUTH_ENDPOINTS = {
  google:    { token: "https://oauth2.googleapis.com/token", auth: "https://accounts.google.com/o/oauth2/auth" },
  openai:    { token: PROVIDER_OAUTH["codex"]?.tokenUrl, auth: PROVIDER_OAUTH["codex"]?.authorizeUrl },
  anthropic: { token: PROVIDER_OAUTH["claude"]?.tokenUrl, auth: "https://api.anthropic.com/v1/oauth/authorize" }, // ≠ claude.authorizeUrl (claude.ai login) — keep
  qwen:      { token: PROVIDER_OAUTH["qwen"]?.tokenUrl, auth: PROVIDER_OAUTH["qwen"]?.deviceCodeUrl },
  iflow:     { token: PROVIDER_OAUTH["iflow"]?.tokenUrl, auth: PROVIDER_OAUTH["iflow"]?.authorizeUrl },
  github:    { token: PROVIDER_OAUTH["github"]?.tokenUrl, auth: PROVIDER_OAUTH["github"]?.authorizeUrl, deviceCode: PROVIDER_OAUTH["github"]?.deviceCodeUrl },
};

let _appVersion;
function getAppPackageVersion() {
  if (_appVersion) return _appVersion;
  try {
    const require = createRequire(import.meta.url);
    _appVersion = require("../../package.json").version || "0.0.0";
  } catch {
    _appVersion = process.env.npm_package_version || "0.0.0";
  }
  return _appVersion;
}

// Kimi Code OAuth / API headers (CLIProxyAPI internal/auth/kimi commonHeaders parity).
// deviceId must stay stable per connection for the whole OAuth session.
export function buildKimiHeaders(deviceId) {
  const osName = platform();
  const architecture = arch();
  let deviceModel = `${osName} ${architecture}`;
  if (osName === "darwin") deviceModel = `macOS ${architecture}`;
  else if (osName === "win32") deviceModel = `Windows ${architecture}`;
  else if (osName === "linux") deviceModel = `Linux ${architecture}`;

  let deviceName = "unknown";
  try {
    deviceName = hostname() || "unknown";
  } catch {
    deviceName = "unknown";
  }

  const resolvedId = (typeof deviceId === "string" && deviceId.trim())
    ? deviceId.trim()
    : `kimi-${Date.now()}`;

  return {
    "X-Msh-Platform": "9router",
    "X-Msh-Version": getAppPackageVersion(),
    "X-Msh-Device-Name": deviceName,
    "X-Msh-Device-Model": deviceModel,
    "X-Msh-Device-Id": resolvedId,
  };
}
