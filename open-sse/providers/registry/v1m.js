export default {
  id: "v1m",
  priority: 45,
  alias: "v1m",
  aliases: ["systemone", "jev"],
  uiAlias: "v1m",
  display: {
    name: "v1m (System One)",
    icon: "psychology",
    color: "#6366F1",
    textIcon: "V1",
    website: "https://v1m.ir",
    notice: {
      text: "v1m System One calibrated decision engine. Fast probabilistic evaluations over state and questions.",
      apiKeyUrl: "https://v1m.ir",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasProviderSpecificData: true,
  models: [
    { id: "rev-latest", name: "v1m Rev Latest (Calibrated)", kind: "systemone" },
    { id: "v1m-decision-engine", name: "v1m Decision Engine", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://v1m.ir/v1/systemone",
    authType: "apikey",
    authHeader: "bearer",
  },
};
