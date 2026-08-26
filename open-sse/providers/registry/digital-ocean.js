export default {
  id: "digital-ocean",
  alias: "do",
  uiAlias: "do",
  display: {
    name: "Digital Ocean",
    icon: "cloud",
    color: "#0080FF",
    textIcon: "DO",
    website: "https://www.digitalocean.com",
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://inference.do-ai.run/v1/chat/completions",
    validateUrl: "https://inference.do-ai.run/v1/models",
  },
  models: [],
  passthroughModels: true,
};
