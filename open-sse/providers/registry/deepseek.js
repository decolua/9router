import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "deepseek",
  priority: 110,
  hasFree: true,
  alias: "deepseek",
  aliases: ["ds"],
  uiAlias: "ds",
  display: {
    name: "DeepSeek",
    icon: "bolt",
    color: "#4D6BFE",
    textIcon: "DS",
    website: "https://platform.deepseek.com",
    notice: {
      text: "Free tier: 5M tokens one-time grant on signup (~$8 value), no CC. Pricing after: $0.14/M input $0.28/M output.",
      apiKeyUrl: "https://platform.deepseek.com/api_keys",
    },
  },
  category: "freeTier",
  hasFree: true,
  transport: {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    validateUrl: "https://api.deepseek.com/v1/models",
    reasoningInject: { scope: "all" },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.deepseek.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", free: true },
    { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro Max", upstreamModelId: "deepseek-v4-pro", free: true },
    { id: "deepseek-v4-pro-none", name: "DeepSeek V4 Pro No Thinking", upstreamModelId: "deepseek-v4-pro", free: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", free: true },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (Exp)", free: true },
    { id: "deepseek-chat", name: "DeepSeek V3.2 Chat", free: true },
    { id: "deepseek-reasoner", name: "DeepSeek V3.2 Reasoner", free: true },
  ],
  modelsFetcher: { url: "https://api.deepseek.com/v1/models", type: "openai" },
  passthroughModels: true,
  features: { usage: true, usageApikey: true },
};
