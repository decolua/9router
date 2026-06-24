export default {
  id: "blackbox",
  priority: 50,
  alias: "blackbox",
  aliases: [
    "bb",
  ],
  uiAlias: "bb",
  display: {
    name: "Blackbox AI",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "BB",
    website: "https://blackbox.ai",
    notice: {
      apiKeyUrl: "https://www.blackbox.ai/api-management",
    },
  },
  category: "apikey",
  serviceKinds: ["llm"],
  thinkingConfig: {
    options: ["auto", "none", "low", "medium", "high", "xhigh"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.blackbox.ai/v1/chat/completions",
    thinkingFormat: "openai",
  },
  models: [
    { id: "claude-fable-5",    name: "Claude Fable 5",    upstreamModelId: "blackboxai/anthropic/claude-fable-5" },
    { id: "claude-opus-4.8",   name: "Claude Opus 4.8",  upstreamModelId: "blackboxai/anthropic/claude-opus-4.8" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", upstreamModelId: "blackboxai/anthropic/claude-sonnet-4.6" },
    { id: "gpt-5.5",           name: "GPT-5.5",           upstreamModelId: "blackboxai/openai/gpt-5.5" },
    { id: "gpt-5.4-pro",       name: "GPT-5.4 Pro",       upstreamModelId: "blackboxai/openai/gpt-5.4-pro" },
    { id: "gpt-5.4",           name: "GPT-5.4",           upstreamModelId: "blackboxai/openai/gpt-5.4" },
    { id: "gpt-5.3-codex",     name: "GPT-5.3 Codex",     upstreamModelId: "blackboxai/openai/gpt-5.3-codex" },
    { id: "gpt-5.4-nano",      name: "GPT-5.4 Nano",      upstreamModelId: "blackboxai/openai/gpt-5.4-nano" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", upstreamModelId: "blackboxai/deepseek/deepseek-v4-flash" },
    { id: "grok-4.3",          name: "Grok 4.3",          upstreamModelId: "blackboxai/x-ai/grok-4.3" },
  ],
};
