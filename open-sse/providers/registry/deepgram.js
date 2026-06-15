export default {
  id: "deepgram",
  priority: 20,
  alias: "deepgram",
  aliases: [
    "dg",
  ],
  uiAlias: "dg",
  display: {
    name: "Deepgram",
    icon: "mic",
    color: "#13EF93",
    textIcon: "DG",
    website: "https://deepgram.com",
    notice: {
      text: "$200 free credit on signup (no card required). Aura-1: $0.015/1k chars, Aura-2: $0.030/1k chars (Pay-As-You-Go).",
      apiKeyUrl: "https://console.deepgram.com/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.deepgram.com/v1/listen",
  },
  models: [
    { id: "nova-3", name: "Nova 3", params: ["language"], kind: "stt" },
    { id: "nova-2", name: "Nova 2", params: ["language"], kind: "stt" },
    { id: "whisper-large", name: "Whisper Large", params: ["language"], kind: "stt" },
    { id: "nova", name: "Nova", kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: { baseUrl: "https://api.deepgram.com/v1/listen", authType: "apikey", authHeader: "token", format: "deepgram" },
};
