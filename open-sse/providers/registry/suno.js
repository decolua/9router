// OmniRoute suno provider — music generation (studio-api.suno.ai). Default
// executor passthrough with session-cookie auth; clients send the Suno-shaped
// generation body.
export default {
  id: "suno",
  priority: 70,
  alias: "suno",
  display: {
    name: "Suno",
    icon: "music_note",
    color: "#F472B6",
    textIcon: "SU",
    website: "https://suno.com",
  },
  category: "apikey",
  hidden: true,
  transport: {
    baseUrl: "https://studio-api.suno.ai/api/generate/v2/",
    auth: {
      combined: true,
      header: "Cookie",
      scheme: "raw",
    },
    quirks: {},
  },
  models: [
    { id: "chirp-v3-5", name: "Chirp V3.5" },
    { id: "chirp-v4", name: "Chirp V4" },
  ],
};
