export default {
  id: "tortoise",
  alias: "tortoise",
  display: {
    name: "Tortoise TTS",
    icon: "record_voice_over",
    color: "#7C3AED",
    textIcon: "TT",
    website: "https://github.com/neonbjb/tortoise-tts"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "tts"
  ],
  noAuth: true,
  ttsConfig: {
    baseUrl: "http://localhost:5000/api/tts",
    authType: "none",
    authHeader: "none",
    format: "tortoise",
    models: [
      {
        id: "tortoise-v2",
        name: "Tortoise v2"
      }
    ]
  },
  hidden: true
};
