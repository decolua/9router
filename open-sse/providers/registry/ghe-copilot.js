import github from "./github.js";

const models = [
  {
    "id": "claude-fable-5",
    "name": "Claude Fable 5"
  },
  {
    "id": "claude-opus-5",
    "name": "Claude Opus 5"
  },
  {
    "id": "claude-opus-4.8-fast",
    "name": "Claude Opus 4.8 (fast mode)"
  },
  {
    "id": "claude-opus-4.8",
    "name": "Claude Opus 4.8"
  },
  {
    "id": "claude-opus-4.7",
    "name": "Claude Opus 4.7"
  },
  {
    "id": "claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6"
  },
  {
    "id": "claude-opus-4.5",
    "name": "Claude Opus 4.5"
  },
  {
    "id": "claude-sonnet-5",
    "name": "Claude Sonnet 5"
  },
  {
    "id": "claude-sonnet-4.5",
    "name": "Claude Sonnet 4.5"
  },
  {
    "id": "claude-haiku-4.5",
    "name": "Claude Haiku 4.5"
  },
  {
    "id": "gemini-3.1-pro-preview",
    "name": "Gemini 3.1 Pro"
  },
  {
    "id": "gemini-3.7-flash",
    "name": "Gemini 3.7 Flash"
  },
  {
    "id": "gpt-5.6-sol",
    "name": "GPT-5.6 Sol"
  },
  {
    "id": "gpt-5.6-terra",
    "name": "GPT-5.6 Terra"
  },
  {
    "id": "gpt-5.6-luna",
    "name": "GPT-5.6 Luna"
  },
  {
    "id": "gpt-5.5",
    "name": "GPT-5.5"
  },
  {
    "id": "gpt-5.4",
    "name": "GPT-5.4"
  },
  {
    "id": "gpt-5.4-mini",
    "name": "GPT-5.4 mini"
  },
  {
    "id": "gpt-5.3-codex",
    "name": "GPT-5.3-Codex"
  },
  {
    "id": "gpt-5-mini",
    "name": "GPT-5 mini"
  },
  {
    "id": "gpt-4o-2024-11-20",
    "name": "GPT-4o"
  },
  {
    "id": "gpt-4o-mini",
    "name": "GPT-4o mini"
  },
  {
    "id": "gpt-4-0125-preview",
    "name": "GPT 4 Turbo"
  },
  {
    "id": "kimi-k2.7-code",
    "name": "Kimi K2.7 Code"
  },
  {
    "id": "mai-code-1-flash",
    "name": "MAI-Code-1-Flash"
  },
  {
    "id": "oswe-vscode-prime",
    "name": "Raptor mini"
  }
];

export default {
  ...github,
  id: "ghe-copilot",
  alias: "ghe",
  uiAlias: "ghe",
  hidden: false,
  priority: 41,

  display: {
    ...(github.display || {}),
    name: "GitHub Enterprise Copilot",
    textIcon: "GHE",
    deprecated: false,
    deprecationNotice: undefined,
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,

  transport: {
    ...(github.transport || {}),
    baseUrl: "https://api.githubcopilot.com/chat/completions",
    responsesUrl: "https://api.githubcopilot.com/responses",
    messagesUrl: "https://api.githubcopilot.com/v1/messages",
    forceStream: true,
  },

  models,
  serviceKinds: ["llm"],
  passthroughModels: false,

  oauth: {
    ...(github.oauth || {}),
  },
};
