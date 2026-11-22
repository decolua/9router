export default {
  id: "atria",
  priority: 120,
  alias: "atria",
  aliases: [
    "atria-asi",
  ],
  uiAlias: "atria",
  display: {
    name: "Atria Dawn",
    icon: "flare",
    color: "#C2410C",
    textIcon: "AD",
    website: "https://atria-asi.ai",
    notice: {
      text: "OpenAI-compatible endpoint from Atria Dawn (AtomInnoLab). Text model IDs include Atria-Dawn and Atria-Dawn-Preview.",
      apiKeyUrl: "https://api.atria-asi.ai/dashboard",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    validateUrl: "https://api.atria-asi.ai/v1/models",
  },
  // Model IDs are case-sensitive. Text-only for now: the service ships a hook
  // that blocks image/PDF input, so no vision is claimed.
  models: [
    { id: "Atria-Dawn", name: "Atria Dawn" },
    { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
  ],
  passthroughModels: true,
};
