export default {
  id: "coqui",
  alias: "coqui",
  display: {
    name: "Coqui TTS",
    icon: "record_voice_over",
    color: "#10B981",
    textIcon: "CQ",
    website: "https://github.com/coqui-ai/TTS"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "tts"
  ],
  noAuth: true,
  ttsConfig: {
    baseUrl: "http://localhost:5002/api/tts",
    authType: "none",
    authHeader: "none",
    format: "coqui",
    models: [
      {
        id: "tts_models/en/ljspeech/tacotron2-DDC",
        name: "Tacotron2 DDC (LJSpeech)"
      }
    ]
  },
  hidden: true
};
