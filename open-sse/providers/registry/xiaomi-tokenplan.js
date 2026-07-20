import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "xiaomi-tokenplan",
  priority: 300,
  alias: "xiaomi-tokenplan",
  aliases: [
    "xmtp",
  ],
  uiAlias: "xmtp",
  display: {
    name: "Xiaomi MiMo (Token Plan)",
    icon: "smart_toy",
    color: "#FF6700",
    textIcon: "XT",
    website: "https://mimo.xiaomi.com",
    notice: {
      text: "Xiaomi MiMo Token Plan subscription (API key starts with tp-). Token Plan keys are cluster-specific — select the region matching your subscription.",
      apiKeyUrl: "https://mimo.xiaomi.com",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  regions: [
    { id: "sgp", label: "Singapore (新加坡)" },
    { id: "cn", label: "China (中国大陆)" },
    { id: "ams", label: "Amsterdam (阿姆斯特丹)" },
  ],
  defaultRegion: "sgp",
  transport: {
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions",
    regions: {
      sgp: "https://token-plan-sgp.xiaomimimo.com/v1",
      cn: "https://token-plan-cn.xiaomimimo.com/v1",
      ams: "https://token-plan-ams.xiaomimimo.com/v1",
    },
    defaultRegion: "sgp",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  // baseUrl omitted — region-dynamic, resolved in the executor's buildUrl.
  transports: [
    {
      format: "openai",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "mimo-v2.5-pro-claude", name: "MiMo V2.5 Pro (Claude Native)", targetFormat: "claude", upstreamModelId: "mimo-v2.5-pro" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    { id: "mimo-v2-tts", name: "MiMo V2 TTS" },
    { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS" },
    { id: "mimo-v2.5-tts-voiceclone", name: "MiMo V2.5 TTS Voice Clone" },
    { id: "mimo-v2.5-tts-voicedesign", name: "MiMo V2.5 TTS Voice Design" },
  ],
};
