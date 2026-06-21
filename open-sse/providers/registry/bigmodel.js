export default {
  id: "bigmodel",
  priority: 130,
  alias: "bigmodel",
  display: {
    name: "BigModel",
    icon: "https://bigmodel.cn/img/icons/apple-touch-icon-152x152.png",
    color: "#DC2626",
    textIcon: "BM",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    headers: {},
    usage: {
      url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    },
  },
  models: [
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "glm-4.6", name: "GLM-4.6" },
    { id: "glm-4.5-air", name: "GLM-4.5-Air" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
