import zed from "./zed.js";

export default {
  ...zed,
  id: "zed-hosted",
  alias: "zdh",
  uiAlias: "zdh",
  hidden: false,

  display: {
    ...(zed.display || {}),
    name: "Zed Hosted",
    textIcon: "ZH",
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,

  transport: {
    ...(zed.transport || {}),
    baseUrl: "https://cloud.zed.dev/completions",
    modelsUrl: "https://cloud.zed.dev/models",
    forceStream: true,
  },

  models: [],
  serviceKinds: ["llm"],
  passthroughModels: true,
};
