export default {
  id: "upstage",
  priority: 120,
  hasFree: true,
  alias: "upstage",
  display: {
    name: "Upstage (Solar)",
    icon: "wb_sunny",
    color: "#FF8C00",
    textIcon: "UP",
    website: "https://console.upstage.ai",
    notice: {
      apiKeyUrl: "https://console.upstage.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.upstage.ai/v1/solar/chat/completions",
    validateUrl: "https://api.upstage.ai/v1/models",
  },
  models: [
    { id: "solar-pro", name: "Solar Pro" },
    { id: "solar-mini", name: "Solar Mini" },
  ],
};
