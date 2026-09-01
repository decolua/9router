import antigravity from "./antigravity.js";

export default {
  ...antigravity,

  id: "agy",
  alias: "agy",
  uiAlias: "agy",

  display: {
    ...(antigravity.display || {}),
    name: "Antigravity CLI",
    textIcon: "AG",
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],

  serviceKinds:
    antigravity.serviceKinds || ["llm"],

  passthroughModels: true,
};
