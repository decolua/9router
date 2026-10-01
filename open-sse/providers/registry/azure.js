export default {
  id: "azure",
  priority: 40,
  alias: "azure",
  display: {
    name: "Azure OpenAI",
    icon: "cloud",
    color: "#0078D4",
    textIcon: "AZ",
    website: "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    notice: {
      apiKeyUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  transport: {
    baseUrl: "",
    headers: {},
    // One Azure resource exposes two API surfaces: the legacy per-deployment
    // /chat/completions and the v1 /responses. The connection picks one via
    // providerSpecificData.apiType — the same switch openai-compatible nodes use.
    supportsApiType: true,
  },
};
