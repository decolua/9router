// CLI Tools configuration
export const CLI_TOOLS = {
  claude: {
    id: "claude",
    name: "Claude Code",
    icon: "terminal",
    color: "#D97757",
    description: "Anthropic Claude Code CLI",
    configType: "env",
    envVars: {
      baseUrl: "ANTHROPIC_BASE_URL",
      model: "ANTHROPIC_MODEL",
      opusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
      sonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
      haikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    },
    modelAliases: ["default", "sonnet", "opus", "haiku", "opusplan"],
    settingsFile: "~/.claude/settings.json",
    defaultModels: [
      { id: "opus", name: "Claude Opus", alias: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL", defaultValue: "cc/claude-opus-4-6" },
      { id: "sonnet", name: "Claude Sonnet", alias: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "cc/claude-sonnet-4-6" },
      { id: "haiku", name: "Claude Haiku", alias: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL", defaultValue: "cc/claude-haiku-4-5-20251001" },
    ],
  },
  openclaw: {
    id: "openclaw",
    name: "Open Claw",
    image: "/providers/openclaw.png",
    color: "#FF6B35",
    description: "Open Claw AI Assistant",
    configType: "custom",
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex CLI",
    image: "/providers/codex.png",
    color: "#10A37F",
    description: "OpenAI Codex CLI",
    configType: "custom",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    image: "/providers/opencode.png",
    color: "#E87040",
    description: "OpenCode AI Terminal Assistant",
    configType: "custom",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    image: "/providers/antigravity.png",
    color: "#4285F4",
    description: "Google Antigravity IDE with MITM",
    configType: "mitm",
    mitmDomain: "daily-cloudcode-pa.googleapis.com",
    modelAliases: ["claude-opus-4-6-thinking", "claude-sonnet-4-6", "gemini-3-flash", "gpt-oss-120b-medium", "gemini-3-pro-high", "gemini-3-pro-low"],
    defaultModels: [
      { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro High", alias: "gemini-3.1-pro-high" },
      { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro Low", alias: "gemini-3.1-pro-low" },
      { id: "gemini-3-flash", name: "Gemini 3 Flash", alias: "gemini-3-flash" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", alias: "claude-sonnet-4-6" },
      { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 Thinking", alias: "claude-opus-4-6-thinking" },
      { id: "gpt-oss-120b-medium", name: "GPT OSS 120B Medium", alias: "gpt-oss-120b-medium" },
    ],
  },
  copilot: {
    id: "copilot",
    name: "GitHub Copilot",
    image: "/providers/copilot.png",
    color: "#1F6FEB",
    description: "GitHub Copilot IDE with MITM",
    configType: "mitm",
    mitmDomain: "api.individual.githubcopilot.com",
    modelAliases: ["gpt-4o-mini", "claude-haiku-4.5", "gpt-4o", "gpt-5-mini"],
    defaultModels: [
      { id: "gpt-4o", name: "GPT-4o", alias: "gpt-4o" },
      { id: "gpt-4.1", name: "GPT-4.1", alias: "gpt-4.1" },
      { id: "gpt-5-mini", name: "GPT-5 Mini", alias: "gpt-5-mini" },
      { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", alias: "claude-haiku-4.5" },
    ],
  },
  droid: {
    id: "droid",
    name: "Factory Droid",
    image: "/providers/droid.png",
    color: "#00D4FF",
    description: "Factory Droid AI Assistant",
    configType: "custom",
  },
  amp: {
    id: "amp",
    name: "Amp CLI",
    image: "/providers/amp.svg",
    color: "#000000",
    description: "Amp AI Coding Assistant",
    configType: "custom",
    settingsFile: "~/.config/amp/settings.json",
    secretsFile: "~/.local/share/amp/secrets.json",
    envVars: {
      url: "AMP_URL",
      apiKey: "AMP_API_KEY",
    },
    defaultModels: [
      { id: "smart", name: "Smart (claude-opus-4-6)", alias: "claude-opus-4-6", defaultValue: "cc/claude-opus-4-6", description: "Main agent — Claude Opus 4.6" },
      { id: "deep", name: "Deep (gpt-5.3-codex)", alias: "gpt-5.3-codex", defaultValue: "cx/gpt-5.3-codex", description: "Deep agent — GPT-5.3 Codex" },
      { id: "librarian", name: "Librarian (claude-sonnet-4-5)", alias: "claude-sonnet-4-5-20241022", defaultValue: "cc/claude-sonnet-4-5-20241022", description: "Librarian subagent — Claude Sonnet 4.5" },
      { id: "rush", name: "Rush/Titling (claude-haiku-4-5)", alias: "claude-haiku-4-5-20251001", defaultValue: "cc/claude-haiku-4-5-20251001", description: "Rush & titling — Claude Haiku 4.5" },
      { id: "search", name: "Search (gemini-3-flash)", alias: "gemini-3-flash-preview", defaultValue: "gc/gemini-3-flash-preview", description: "Search subagent — Gemini 3 Flash" },
      { id: "oracle", name: "Oracle (gpt-5.2)", alias: "gpt-5.2", defaultValue: "cx/gpt-5.2", description: "Oracle agent — GPT-5.2" },
      { id: "review", name: "Review (gemini-3-pro)", alias: "gemini-3-pro-preview", defaultValue: "gc/gemini-3-pro-preview", description: "Review — Gemini 3 Pro" },
      { id: "handoff", name: "Handoff (gemini-2.5-flash)", alias: "gemini-2.5-flash", defaultValue: "gc/gemini-2.5-flash", description: "Handoff — Gemini 2.5 Flash" },
      { id: "topics", name: "Topics (gemini-2.5-flash-lite)", alias: "gemini-2.5-flash-lite-preview-09-2025", defaultValue: "gc/gemini-2.5-flash-lite-preview-09-2025", description: "Topics — Gemini 2.5 Flash-Lite" },
    ],
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    image: "/providers/cursor.png",
    color: "#000000",
    description: "Cursor AI Code Editor",
    configType: "guide",
    requiresExternalUrl: true,
    notes: [
      { type: "warning", text: "Requires Cursor Pro account to use this feature." },
      { type: "cloudCheck", text: "Cursor routes requests through its own server, so local endpoint is not supported. Please enable Tunnel or Cloud Endpoint in Settings." },
    ],
    guideSteps: [
      { step: 1, title: "Open Settings", desc: "Go to Settings → Models" },
      { step: 2, title: "Enable OpenAI API", desc: "Enable \"OpenAI API key\" option" },
      { step: 3, title: "Base URL", value: "{{baseUrl}}", copyable: true },
      { step: 4, title: "API Key", type: "apiKeySelector" },
      { step: 5, title: "Add Custom Model", desc: "Click \"View All Model\" → \"Add Custom Model\"" },
      { step: 6, title: "Select Model", type: "modelSelector" },
    ],
  },
  cline: {
    id: "cline",
    name: "Cline",
    image: "/providers/cline.png",
    color: "#00D1B2",
    description: "Cline AI Coding Assistant",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Settings", desc: "Go to Cline Settings panel" },
      { step: 2, title: "Select Provider", desc: "Choose API Provider → OpenAI Compatible" },
      { step: 3, title: "Base URL", value: "{{baseUrl}}/v1", copyable: true },
      { step: 4, title: "API Key", type: "apiKeySelector" },
      { step: 5, title: "Select Model", type: "modelSelector" },
    ],
  },
  kilo: {
    id: "kilo",
    name: "Kilo Code",
    image: "/providers/kilocode.png",
    color: "#FF6B6B",
    description: "Kilo Code AI Assistant",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Settings", desc: "Go to Kilo Code Settings panel" },
      { step: 2, title: "Select Provider", desc: "Choose API Provider → OpenAI Compatible" },
      { step: 3, title: "Base URL", value: "{{baseUrl}}/v1", copyable: true },
      { step: 4, title: "API Key", type: "apiKeySelector" },
      { step: 5, title: "Select Model", type: "modelSelector" },
    ],
  },
  roo: {
    id: "roo",
    name: "Roo",
    image: "/providers/roo.png",
    color: "#FF6B6B",
    description: "Roo AI Assistant",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Settings", desc: "Go to Roo Settings panel" },
      { step: 2, title: "Select Provider", desc: "Choose API Provider → Ollama" },
      { step: 3, title: "Base URL", value: "{{baseUrl}}", copyable: true },
      { step: 4, title: "API Key", type: "apiKeySelector" },
      { step: 5, title: "Select Model", type: "modelSelector" },
    ],
  },
  continue: {
    id: "continue",
    name: "Continue",
    image: "/providers/continue.png",
    color: "#7C3AED",
    description: "Continue AI Assistant",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Config", desc: "Open Continue configuration file" },
      { step: 2, title: "API Key", type: "apiKeySelector" },
      { step: 3, title: "Select Model", type: "modelSelector" },
      { step: 4, title: "Add Model Config", desc: "Add the following configuration to your models array:" },
    ],
    codeBlock: {
      language: "json",
      code: `{
  "apiBase": "{{baseUrl}}",
  "title": "{{model}}",
  "model": "{{model}}",
  "provider": "openai",
  "apiKey": "{{apiKey}}"
}`,
    },
  },
  // HIDDEN: gemini-cli
  // "gemini-cli": {
  //   id: "gemini-cli",
  //   name: "Gemini CLI",
  //   icon: "terminal",
  //   color: "#4285F4",
  //   description: "Google Gemini CLI",
  //   configType: "env",
  //   envVars: {
  //     baseUrl: "GEMINI_API_BASE_URL",
  //     model: "GEMINI_MODEL",
  //   },
  //   defaultModels: [
  //     { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", alias: "pro" },
  //     { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", alias: "flash" },
  //   ],
  // },
};

// Get all provider models for mapping dropdown
export const getProviderModelsForMapping = (providers) => {
  const result = [];
  providers.forEach(conn => {
    if (conn.isActive && (conn.testStatus === "active" || conn.testStatus === "success")) {
      result.push({
        connectionId: conn.id,
        provider: conn.provider,
        name: conn.name,
        models: conn.models || [],
      });
    }
  });
  return result;
};

