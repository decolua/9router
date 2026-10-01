export default {
  id: "local-device",
  alias: "local-device",
  display: {
    name: "Local Device",
    icon: "speaker",
    color: "#64748B",
    textIcon: "LD"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "tts"
  ],
  mediaPriority: 5,
  noAuth: true,
  ttsConfig: {
    baseUrl: "local-device",
    authType: "none",
    authHeader: "none",
    format: "local-device",
    models: []
  }
};
