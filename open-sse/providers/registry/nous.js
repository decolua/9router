import {
  NOUS_CHAT_COMPLETIONS_URL,
  NOUS_MODELS_URL,
} from "../../services/nous.js";

const nous = {
  id: "nous",
  priority: 65,
  hasFree: true,
  alias: "nous",
  aliases: ["nous-portal", "nous-research"],
  uiAlias: "nous",
  display: {
    name: "Nous Research",
    icon: "psychology",
    color: "#111827",
    textIcon: "NR",
    website: "https://nousresearch.com",
    notice: {
      text: "OpenAI-compatible inference. Third-party apps authenticate with a static Nous Portal API key; Hermes 4 does not currently advertise tool calling.",
      apiKeyUrl: "https://portal.nousresearch.com/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: NOUS_CHAT_COMPLETIONS_URL,
  },
  models: [
    {
      id: "nousresearch/hermes-4-70b",
      name: "Nous: Hermes 4 70B",
      contextLength: 131072,
    },
    {
      id: "nousresearch/hermes-4-405b",
      name: "Nous: Hermes 4 405B",
      contextLength: 131072,
    },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: NOUS_MODELS_URL, type: "nous-free" },
  passthroughModels: true,
};

export default nous;
