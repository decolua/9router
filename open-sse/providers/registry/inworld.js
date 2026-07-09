export default {
  id: "inworld",
  alias: "inworld",
  display: {
    name: "Inworld TTS",
    icon: "record_voice_over",
    color: "#FF6B6B",
    textIcon: "IW",
    website: "https://inworld.ai",
    notice: {
      text: "Free tier: 40 minutes/month TTS. Paid: TTS-1.5 Mini $0.01/min ($15/1M chars), TTS-1.5 Max $0.025/min ($30/1M chars). 270+ voices, 15 languages.",
      apiKeyUrl: "https://platform.inworld.ai/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "tts"
  ],
  ttsConfig: {
    baseUrl: "https://api.inworld.ai/tts/v1/voice",
    authType: "apikey",
    authHeader: "basic",
    format: "inworld",
    models: [
      {
        id: "inworld-tts-1.5-mini",
        name: "Inworld TTS 1.5 Mini ($0.01/min)"
      },
      {
        id: "inworld-tts-1.5-max",
        name: "Inworld TTS 1.5 Max ($0.025/min)"
      }
    ]
  }
};
