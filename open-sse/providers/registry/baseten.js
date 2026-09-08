// Baseten Model APIs — OpenAI-compatible hosted inference surface at
// https://inference.baseten.co/v1 (docs.baseten.co/inference/model-apis).
// Model ids are org-prefixed slugs ("zai-org/GLM-5.2"). The live catalog is
// fetched via modelsFetcher; new slugs stay routable via passthroughModels.
// Reasoning: default-on models take top-level reasoning_effort; opt-in models
// additionally need chat_template_args.enable_thinking — see the "baseten"
// case in translator/concerns/thinkingUnified.js and PROVIDER_CAPABILITIES
// (thinkingOptIn) in providers/capabilities.js.
export default {
  id: "baseten",
  alias: "baseten",
  aliases: ["b10"],
  display: {
    name: "Baseten",
    icon: "rocket_launch",
    color: "#FF5A1F",
    textIcon: "B10",
    website: "https://www.baseten.co",
    notice: {
      apiKeyUrl: "https://app.baseten.co/settings/api_keys",
      text: "OpenAI-compatible Model APIs: high-performance hosted LLMs (GLM, DeepSeek V4, Kimi, gpt-oss, Nemotron, Inkling).",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.baseten.co/v1/chat/completions",
    validateUrl: "https://inference.baseten.co/v1/models",
    thinkingFormat: "baseten",
  },
  // Seed snapshot from the docs supported-models table; the latest catalog is
  // fetched via modelsFetcher and any other slug is accepted via passthroughModels.
  models: [
    { id: "zai-org/GLM-5.3", name: "GLM 5.3" },
    { id: "zai-org/GLM-5.3-Fast", name: "GLM 5.3 Fast" },
    { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
    { id: "zai-org/GLM-5.2-Fast", name: "GLM 5.2 Fast" },
    { id: "zai-org/GLM-4.7", name: "GLM 4.7" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V4-Pro-0813", name: "DeepSeek V4 Pro 0813" },
    { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "moonshotai/Kimi-K3", name: "Kimi K3" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code" },
    { id: "openai/gpt-oss-120b", name: "OpenAI GPT 120B" },
    { id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B", name: "Nemotron 3 Ultra" },
    { id: "thinkingmachines/inkling", name: "Inkling" },
    { id: "thinkingmachines/inkling-small", name: "Inkling Small" },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: "https://inference.baseten.co/v1/models", type: "openai" },
  passthroughModels: true,
};
