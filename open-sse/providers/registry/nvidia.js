export default {
  id: "nvidia",
  priority: 20,
  hasFree: true,
  alias: "nvidia",
  display: {
    name: "NVIDIA NIM",
    icon: "developer_board",
    color: "#76B900",
    textIcon: "NV",
    website: "https://developer.nvidia.com/nim",
    notice: {
      text: "Free access for NVIDIA Developer Program members (prototyping & testing).",
      apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    validateUrl: "https://integrate.api.nvidia.com/v1/models",
  },
  // NIM's catalogue is large and moves fast. integrate.api.nvidia.com/v1/models
  // requires a key, so there is no modelsFetcher here — the list below is a
  // curated seed of the reasoning-capable text→text models (the ones that work
  // through /v1/chat/completions), taken from models.dev's nvidia provider.
  // Image-gen, video, embedding-only, rerank and safety models are omitted:
  // they are served from other endpoints, not chat.
  // passthroughModels keeps any newer id usable without a registry edit.
  models: [
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    { id: "z-ai/glm-5.3", name: "GLM 5.3" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" },
    { id: "thinkingmachines/inkling", name: "Inkling" },
    { id: "deepseek-ai/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813" },
    { id: "deepseek-ai/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "nvidia/nemotron-3.5-lightning-30b-a3b", name: "Nemotron 3.5 Lightning 30B" },
    { id: "nvidia/nemotron-3-super-120b-a12b", name: "Nemotron 3 Super 120B" },
    { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", name: "Nemotron 3 Nano Omni 30B" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b", name: "Nemotron 3 Ultra" },
    { id: "nvidia/llama-3.3-nemotron-super-49b-v1.5", name: "Llama 3.3 Nemotron Super 49B v1.5" },
    { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1", name: "Llama 3.1 Nemotron Ultra 253B" },
    { id: "nvidia/nemotron-nano-12b-v2-vl", name: "Nemotron Nano 12B v2 VL" },
    { id: "nvidia/nvidia-nemotron-nano-9b-v2", name: "Nemotron Nano 9B v2" },
    { id: "nvidia/nemotron-3-nano-30b-a3b", name: "Nemotron 3 Nano 30B" },
    { id: "qwen/qwen3.5-397b-a17b", name: "Qwen 3.5 397B" },
    { id: "qwen/qwen3.5-122b-a10b", name: "Qwen 3.5 122B" },
    { id: "qwen/qwen3-coder-480b-a35b-instruct", name: "Qwen 3 Coder 480B" },
    { id: "mistralai/mistral-medium-3.5-128b", name: "Mistral Medium 3.5 128B" },
    { id: "mistralai/mistral-small-4-119b-2603", name: "Mistral Small 4 119B" },
    { id: "stepfun-ai/step-3.7-flash", name: "Step 3.7 Flash" },
    { id: "stepfun-ai/step-3.5-flash", name: "Step 3.5 Flash" },
    { id: "poolside/laguna-xs-2.1", name: "Laguna XS 2.1" },
    { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
    { id: "meta/muse-glimmer-30b", name: "Muse Glimmer 30B" },
    { id: "google/gemma-4-31b-it", name: "Gemma 4 31B" },
    { id: "microsoft/phi-4-mini-instruct", name: "Phi 4 Mini" },
    { id: "minimaxai/minimax-m3", name: "MiniMax M3" },
    { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", kind: "embedding" },
    { id: "nvidia/parakeet-ctc-1.1b-asr", name: "Parakeet CTC 1.1B", params: ["language"], kind: "stt" },
    { id: "fastpitch", name: "FastPitch", kind: "tts" },
    { id: "tacotron2", name: "Tacotron2", kind: "tts" },
  ],
  // NIM rotates its catalogue often; an id added upstream should work the day
  // it appears rather than after a registry edit.
  passthroughModels: true,
  serviceKinds: ["llm","tts","embedding"],
  ttsConfig: {
    baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech",
    authType: "apikey",
    authHeader: "bearer",
    format: "nvidia-tts",
  },
  embeddingConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authType: "apikey", authHeader: "bearer" },
};
