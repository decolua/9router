export default {
  id: "ai21",
  priority: 110,
  hasFree: true,
  alias: "ai21",
  display: {
    name: "AI21 (Jamba)",
    icon: "auto_awesome",
    color: "#A855F7",
    textIcon: "J1",
    website: "https://studio.ai21.com",
    notice: {
      apiKeyUrl: "https://studio.ai21.com/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    validateUrl: "https://api.ai21.com/studio/v1/models",
  },
  models: [
    { id: "jamba-large", name: "Jamba Large" },
    { id: "jamba-mini", name: "Jamba Mini" },
    { id: "jamba-1.5-large", name: "Jamba 1.5 Large" },
    { id: "jamba-1.5-mini", name: "Jamba 1.5 Mini" },
  ],
};
