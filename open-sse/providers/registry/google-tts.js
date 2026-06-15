export default {
  id: "google-tts",
  alias: "google-tts",
  display: {
    name: "Google TTS",
    icon: "record_voice_over",
    color: "#4285F4",
    textIcon: "GT"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "tts"
  ],
  mediaPriority: 5,
  noAuth: true,
  ttsConfig: {
    baseUrl: "google-tts",
    authType: "none",
    authHeader: "none",
    format: "google-tts",
    models: []
  }
};
