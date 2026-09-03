export default {
  id: "elevenlabs",
  alias: "el",
  display: {
    name: "ElevenLabs",
    icon: "record_voice_over",
    color: "#6C47FF",
    textIcon: "EL",
    website: "https://elevenlabs.io",
    notice: {
      apiKeyUrl: "https://elevenlabs.io/app/settings/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  features: {
    usageApikey: true // expose character-credit usage via /v1/user/subscription
  },
  serviceKinds: [
    "tts"
  ],
  ttsConfig: {
    baseUrl: "https://api.elevenlabs.io/v1/text-to-speech",
    authType: "apikey",
    authHeader: "xi-api-key",
    format: "elevenlabs",
    models: [
      {
        id: "eleven_v3",
        name: "Eleven v3"
      },
      {
        id: "eleven_multilingual_v2",
        name: "Eleven Multilingual v2"
      },
      {
        id: "eleven_flash_v2_5",
        name: "Eleven Flash v2.5"
      },
      {
        id: "eleven_turbo_v2_5",
        name: "Eleven Turbo v2.5"
      }
    ]
  }
};
