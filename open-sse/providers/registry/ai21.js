const ai21 = {
  id: "ai21",
  priority: 70,
  alias: "ai21",
  display: {
    name: "AI21",
    icon: "memory",
    color: "#FF6B35",
    textIcon: "A2",
    website: "https://www.ai21.com",
    notice: {
      apiKeyUrl: "https://studio.ai21.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    validateUrl: "https://api.ai21.com/studio/v1/models",
    quirks: {},
  },
  models: [
    { id: "jamba-large-1.7", name: "Jamba Large 1.7" },
    { id: "jamba-mini-2", name: "Jamba Mini 2" },
  ],
};
export default ai21;
