export default {
  id: "edge-tts",
  alias: "edge-tts",
  display: {
    name: "Edge TTS",
    icon: "record_voice_over",
    color: "#0078D4",
    textIcon: "ET"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "tts"
  ],
  mediaPriority: 5,
  noAuth: true,
  ttsConfig: {
    baseUrl: "edge-tts",
    authType: "none",
    authHeader: "none",
    format: "edge-tts",
    models: []
  }
};
