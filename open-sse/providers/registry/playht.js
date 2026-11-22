export default {
  id: "playht",
  alias: "playht",
  display: {
    name: "PlayHT",
    icon: "play_circle",
    color: "#00B4D8",
    textIcon: "PH",
    website: "https://play.ht",
    notice: {
      apiKeyUrl: "https://play.ht/studio/api-access"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "tts"
  ],
  models: [
      { id: "PlayDialog", name: "PlayDialog", kind: "tts" },
      { id: "Play3.0-mini", name: "Play 3.0 Mini", kind: "tts" },
      { id: "PlayHT2.0-turbo", name: "PlayHT 2.0 Turbo", kind: "tts" },
  ],
  ttsConfig: {
    baseUrl: "https://api.play.ht/api/v2/tts/stream",
    authType: "apikey",
    authHeader: "playht",
    format: "playht",
    models: [
      { id: "PlayDialog", name: "PlayDialog" },
      { id: "Play3.0-mini", name: "Play 3.0 Mini" },
      { id: "PlayHT2.0-turbo", name: "PlayHT 2.0 Turbo" },
    ]
  },
  hidden: true
};
