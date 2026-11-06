export default {
  id: "sensenova",
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "auto_awesome",
    color: "#5B5CE2",
    textIcon: "SN",
    website: "https://token.sensenova.cn",
    notice: {
      apiKeyUrl: "https://token.sensenova.cn",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: ["none", "low", "medium", "high", "max"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    validateUrl: "https://token.sensenova.cn/v1/models",
  },
  models: [
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite" },
    {
      id: "sensenova-u1.5-lite",
      name: "SenseNova U1.5 Lite",
      kind: "image",
      capabilities: ["text2img", "edit"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
    },
    {
      id: "sensenova-u1.5-fast",
      name: "SenseNova U1.5 Fast",
      kind: "image",
      capabilities: ["text2img"],
      params: ["n", "size", "output_format", "response_format", "watermark", "prompt_extend"],
    },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "kimi-k3", name: "Kimi K3" },
  ],
  serviceKinds: ["llm", "image", "imageToText"],
  imageConfig: {
    baseUrl: "https://token.sensenova.cn/v1/images/generations",
    bodyFields: [
      "model",
      "prompt",
      "n",
      "size",
      "output_format",
      "response_format",
      "watermark",
      "prompt_extend",
    ],
  },
};
