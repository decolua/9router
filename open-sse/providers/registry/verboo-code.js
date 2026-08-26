export default {
  id: "verboo-code",
  alias: "vc",
  uiAlias: "vc",
  display: {
    name: "Verboo Code",
    icon: "code",
    color: "#8B5CF6",
    textIcon: "VC",
    website: "https://code.verboo.ai",
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://code.verboo.ai/router/v1/chat/completions",
    validateUrl: "https://code.verboo.ai/router/v1/models",
  },
  models: [],
  passthroughModels: true,
};
