import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "minimax",
  priority: 90,
  alias: "minimax",
  display: {
    name: "Minimax Coding",
    icon: "memory",
    color: "#7C3AED",
    textIcon: "MM",
    website: "https://www.minimaxi.com",
    notice: {
      apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.minimax.io/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    },
    quirks: {
      dropOutputConfig: true,
    },
    reasoningInject: {
      scope: "all",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    usage: {
      urls: [
        "https://www.minimax.io/v1/token_plan/remains",
        "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
      ],
    },
  },
  models: [
    { id: "MiniMax-M3", name: "MiniMax M3", targetFormat: "claude" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
    { id: "minimax-image-01", name: "MiniMax Image 01", params: ["n","size","response_format"], kind: "image" },
    { id: "speech-2.8-hd", name: "Speech 2.8 HD", kind: "tts" },
    { id: "speech-2.8-turbo", name: "Speech 2.8 Turbo", kind: "tts" },
    { id: "speech-2.6-hd", name: "Speech 2.6 HD", kind: "tts" },
    { id: "speech-2.6-turbo", name: "Speech 2.6 Turbo", kind: "tts" },
    { id: "speech-02-hd", name: "Speech 02 HD", kind: "tts" },
    { id: "speech-02-turbo", name: "Speech 02 Turbo", kind: "tts" },
    { id: "speech-01-hd", name: "Speech 01 HD", kind: "tts" },
    { id: "speech-01-turbo", name: "Speech 01 Turbo", kind: "tts" },
  ],
  serviceKinds: ["llm","image","imageToText","webSearch","tts"],
  ttsConfig: { baseUrl: "https://api.minimax.io/v1/t2a_v2", authType: "apikey", authHeader: "bearer", format: "minimax-tts" },
  imageConfig: { baseUrl: "https://api.minimaxi.com/v1/images/generations" },
  searchViaChat: {
    defaultModel: "MiniMax-M2.7",
    endpoint: "https://api.minimaxi.com/v1/text/chatcompletion_v2",
    pricingUrl: "https://www.minimaxi.com/document/price",
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
