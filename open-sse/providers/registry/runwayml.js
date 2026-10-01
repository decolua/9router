export default {
  id: "runwayml",
  priority: 80,
  alias: "runwayml",
  aliases: [
    "runway",
  ],
  uiAlias: "runway",
  display: {
    name: "Runway ML",
    icon: "movie",
    color: "#000000",
    textIcon: "RW",
    website: "https://runwayml.com",
    notice: {
      apiKeyUrl: "https://dev.runwayml.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "gen4_image", name: "Gen-4 Image", params: ["size"], kind: "image" },
    { id: "gen4_image_turbo", name: "Gen-4 Image Turbo", params: ["size"], kind: "image" },
    { id: "gen4_turbo", name: "Gen-4 Turbo", params: [], kind: "video" },
    { id: "gen3a_turbo", name: "Gen-3 Alpha Turbo", params: [], kind: "video" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.dev.runwayml.com/v1" },
};
