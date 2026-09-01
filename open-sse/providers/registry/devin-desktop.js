const models = [
  {
    "id": "swe-1-7-lightning",
    "name": "SWE-1.7 Lightning"
  },
  {
    "id": "swe-1-7",
    "name": "SWE-1.7"
  },
  {
    "id": "swe-1-6-fast",
    "name": "SWE-1.6 Fast"
  },
  {
    "id": "swe-1-6",
    "name": "SWE-1.6"
  },
  {
    "id": "claude-5-fable-max",
    "name": "Claude Fable 5 Max"
  },
  {
    "id": "claude-5-fable-xhigh",
    "name": "Claude Fable 5 XHigh"
  },
  {
    "id": "claude-5-fable-high",
    "name": "Claude Fable 5 High"
  },
  {
    "id": "claude-5-fable-medium",
    "name": "Claude Fable 5 Medium"
  },
  {
    "id": "claude-5-fable-low",
    "name": "Claude Fable 5 Low"
  },
  {
    "id": "claude-opus-5-max",
    "name": "Claude Opus 5 Max"
  },
  {
    "id": "claude-opus-5-xhigh",
    "name": "Claude Opus 5 XHigh"
  },
  {
    "id": "claude-opus-5-high",
    "name": "Claude Opus 5 High"
  },
  {
    "id": "claude-opus-5-medium",
    "name": "Claude Opus 5 Medium"
  },
  {
    "id": "claude-opus-5-low",
    "name": "Claude Opus 5 Low"
  },
  {
    "id": "claude-opus-4-8-max",
    "name": "Claude Opus 4.8 Max"
  },
  {
    "id": "claude-opus-4-8-xhigh",
    "name": "Claude Opus 4.8 XHigh"
  },
  {
    "id": "claude-opus-4-8-high",
    "name": "Claude Opus 4.8 High"
  },
  {
    "id": "claude-opus-4-8-medium",
    "name": "Claude Opus 4.8 Medium"
  },
  {
    "id": "claude-opus-4-8-low",
    "name": "Claude Opus 4.8 Low"
  },
  {
    "id": "claude-opus-4-7-max",
    "name": "Claude Opus 4.7 Max"
  },
  {
    "id": "claude-opus-4-7-xhigh",
    "name": "Claude Opus 4.7 XHigh"
  },
  {
    "id": "claude-opus-4-7-high",
    "name": "Claude Opus 4.7 High"
  },
  {
    "id": "claude-opus-4-7-medium",
    "name": "Claude Opus 4.7 Medium"
  },
  {
    "id": "claude-opus-4-7-low",
    "name": "Claude Opus 4.7 Low"
  },
  {
    "id": "claude-opus-4-6-thinking-1m",
    "name": "Claude Opus 4.6 Thinking 1M"
  },
  {
    "id": "claude-opus-4-6-thinking",
    "name": "Claude Opus 4.6 Thinking"
  },
  {
    "id": "claude-opus-4-6-1m",
    "name": "Claude Opus 4.6 1M"
  },
  {
    "id": "claude-opus-4-6",
    "name": "Claude Opus 4.6"
  },
  {
    "id": "claude-sonnet-5-max",
    "name": "Claude Sonnet 5 Max"
  },
  {
    "id": "claude-sonnet-5-xhigh",
    "name": "Claude Sonnet 5 XHigh"
  },
  {
    "id": "claude-sonnet-5-high",
    "name": "Claude Sonnet 5 High"
  },
  {
    "id": "claude-sonnet-5-medium",
    "name": "Claude Sonnet 5 Medium"
  },
  {
    "id": "claude-sonnet-5-low",
    "name": "Claude Sonnet 5 Low"
  },
  {
    "id": "claude-sonnet-4-6-thinking-1m",
    "name": "Claude Sonnet 4.6 Thinking 1M"
  },
  {
    "id": "claude-sonnet-4-6-thinking",
    "name": "Claude Sonnet 4.6 Thinking"
  },
  {
    "id": "claude-sonnet-4-6-1m",
    "name": "Claude Sonnet 4.6 1M"
  },
  {
    "id": "claude-sonnet-4-6",
    "name": "Claude Sonnet 4.6"
  },
  {
    "id": "gpt-5-6-sol-max",
    "name": "GPT-5.6 Sol Max"
  },
  {
    "id": "gpt-5-6-sol-xhigh",
    "name": "GPT-5.6 Sol XHigh"
  },
  {
    "id": "gpt-5-6-sol-high",
    "name": "GPT-5.6 Sol High"
  },
  {
    "id": "gpt-5-6-sol-medium",
    "name": "GPT-5.6 Sol Medium"
  },
  {
    "id": "gpt-5-6-sol-low",
    "name": "GPT-5.6 Sol Low"
  },
  {
    "id": "gpt-5-6-terra-max",
    "name": "GPT-5.6 Terra Max"
  },
  {
    "id": "gpt-5-6-terra-xhigh",
    "name": "GPT-5.6 Terra XHigh"
  },
  {
    "id": "gpt-5-6-terra-high",
    "name": "GPT-5.6 Terra High"
  },
  {
    "id": "gpt-5-6-terra-medium",
    "name": "GPT-5.6 Terra Medium"
  },
  {
    "id": "gpt-5-6-terra-low",
    "name": "GPT-5.6 Terra Low"
  },
  {
    "id": "gpt-5-6-luna-max",
    "name": "GPT-5.6 Luna Max"
  },
  {
    "id": "gpt-5-6-luna-xhigh",
    "name": "GPT-5.6 Luna XHigh"
  },
  {
    "id": "gpt-5-6-luna-high",
    "name": "GPT-5.6 Luna High"
  },
  {
    "id": "gpt-5-6-luna-medium",
    "name": "GPT-5.6 Luna Medium"
  },
  {
    "id": "gpt-5-6-luna-low",
    "name": "GPT-5.6 Luna Low"
  },
  {
    "id": "gpt-5-5-xhigh",
    "name": "GPT-5.5 XHigh"
  },
  {
    "id": "gpt-5-5-high",
    "name": "GPT-5.5 High"
  },
  {
    "id": "gpt-5-5-medium",
    "name": "GPT-5.5 Medium"
  },
  {
    "id": "gpt-5-5-low",
    "name": "GPT-5.5 Low"
  },
  {
    "id": "gemini-3-1-pro-high",
    "name": "Gemini 3.1 Pro High"
  },
  {
    "id": "gemini-3-1-pro-low",
    "name": "Gemini 3.1 Pro Low"
  },
  {
    "id": "gemini-3-7-flash-high",
    "name": "Gemini 3.7 Flash High"
  },
  {
    "id": "gemini-3-7-flash-medium",
    "name": "Gemini 3.7 Flash Medium"
  },
  {
    "id": "gemini-3-7-flash-low",
    "name": "Gemini 3.7 Flash Low"
  },
  {
    "id": "gemini-3-7-flash-minimal",
    "name": "Gemini 3.7 Flash Minimal"
  },
  {
    "id": "grok-4-5-high",
    "name": "Grok 4.5 High"
  },
  {
    "id": "grok-4-5-medium",
    "name": "Grok 4.5 Medium"
  },
  {
    "id": "grok-4-5-low",
    "name": "Grok 4.5 Low"
  },
  {
    "id": "glm-5-2-max-1m",
    "name": "GLM-5.2 Max 1M"
  },
  {
    "id": "glm-5-2-max",
    "name": "GLM-5.2 Max"
  },
  {
    "id": "glm-5-2-1m",
    "name": "GLM-5.2 High 1M"
  },
  {
    "id": "glm-5-2",
    "name": "GLM-5.2 High"
  },
  {
    "id": "kimi-k3-max",
    "name": "Kimi K3 Max"
  },
  {
    "id": "kimi-k3-high",
    "name": "Kimi K3 High"
  },
  {
    "id": "kimi-k3-low",
    "name": "Kimi K3 Low"
  },
  {
    "id": "kimi-k2-7",
    "name": "Kimi K2.7"
  },
  {
    "id": "inkling-max",
    "name": "Inkling Max"
  },
  {
    "id": "inkling-xhigh",
    "name": "Inkling XHigh"
  },
  {
    "id": "inkling-high",
    "name": "Inkling High"
  },
  {
    "id": "inkling-medium",
    "name": "Inkling Medium"
  },
  {
    "id": "inkling-low",
    "name": "Inkling Low"
  },
  {
    "id": "inkling-none",
    "name": "Inkling None"
  },
  {
    "id": "deepseek-v4",
    "name": "DeepSeek V4 Pro"
  },
  {
    "id": "nemotron-3-ultra-nvfp4",
    "name": "Nemotron 3 Ultra"
  }
];

export default {
  id: "devin-desktop",
  alias: "dvd",
  uiAlias: "dvd",
  hidden: false,
  priority: 60,

  display: {
    name: "Devin Desktop",
    icon: "terminal",
    textIcon: "DV",
    website: "https://devin.ai",
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,

  baseUrl: "https://server.codeium.com",

  transport: {
    baseUrl: "https://server.codeium.com",
    forceStream: true,
  },

  models,
  serviceKinds: ["llm"],
  passthroughModels: false,
};
