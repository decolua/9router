export default {
  id: "assemblyai",
  priority: 30,
  alias: "assemblyai",
  aliases: [
    "aai",
  ],
  uiAlias: "aai",
  display: {
    name: "AssemblyAI",
    icon: "record_voice_over",
    color: "#0062FF",
    textIcon: "AA",
    website: "https://assemblyai.com",
    notice: {
      apiKeyUrl: "https://www.assemblyai.com/app/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.assemblyai.com/v1/audio/transcriptions",
    validateUrl: "https://api.assemblyai.com/v1/account",
  },
  models: [
    { id: "universal-3-pro", name: "Universal 3 Pro", params: ["language"], kind: "stt" },
    { id: "universal-2", name: "Universal 2", params: ["language"], kind: "stt" },
    { id: "best", name: "Best (Nano + Universal)", kind: "stt" },
    { id: "nano", name: "Nano (Fast)", kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    baseUrl: "https://api.assemblyai.com/v2/transcript",
    authType: "apikey",
    authHeader: "authorization",
    format: "assemblyai",
  },
};
