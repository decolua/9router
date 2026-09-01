export default {
  id: "veoaifree-web",
  alias: "veo-free",
  uiAlias: "veo-free",
  hasFree: true,

  display: {
    name: "Veo AI Free",
    icon: "videocam",
    color: "#8B5CF6",
    textIcon: "VF",
    website: "https://veoaifree.com",
  },

  category: "free",
  authType: "none",
  noAuth: true,

  transport: {
    baseUrl:
      "https://veoaifree.com/wp-admin/admin-ajax.php",
    noAuth: true,
  },

  models: [
    {
      id: "veo",
      name: "VEO 3.1",
      kind: "video",
      toolCalling: false,
    },
    {
      id: "seedance",
      name: "Seedance",
      kind: "video",
      toolCalling: false,
    },
  ],

  serviceKinds: ["video"],

  // Current videoGeneration resolver requires videoConfig.
  // This provider does NOT use the generic xAI-style video proxy:
  // handler dispatches to VeoAIFreeWebExecutor instead.
  videoConfig: {
    baseUrl:
      "https://veoaifree.com/wp-admin/admin-ajax.php",
    adapter: "executor",
    executor: "veoaifree-web",
    synchronousResult: true,
  },
};
