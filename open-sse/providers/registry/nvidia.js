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
  models: [
    // NVIDIA native models
    { id: "llama-3.2-11b-vision-instruct", name: "Llama 3.2 11B Vision", upstreamModelId: "meta/llama-3.2-11b-vision-instruct", vision: true },
    { id: "nemotron-3-nano-omni-30b-a3b-reasoning", name: "Nemotron Nano 30B Reasoning", upstreamModelId: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" },
    { id: "nemotron-3.5-lightning-30b-a3b", name: "Nemotron Lightning 30B", upstreamModelId: "nvidia/nemotron-3.5-lightning-30b-a3b" },
    { id: "muse-glimmer-30b", name: "Muse Glimmer 30B", upstreamModelId: "meta/muse-glimmer-30b" },
    { id: "nemotron-3-super-120b-a12b", name: "Nemotron Super 120B", upstreamModelId: "nvidia/nemotron-3-super-120b-a12b" },
    { id: "nemotron-3-ultra-550b-a55b", name: "Nemotron Ultra 550B", upstreamModelId: "nvidia/nemotron-3-ultra-550b-a55b" },
    { id: "gpt-oss-20b", name: "GPT OSS 20B", upstreamModelId: "openai/gpt-oss-20b" },
    // Third-party models available via NVIDIA NIM
    { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "minimaxai/minimax-m3", name: "MiniMax M3" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    // Non-LLM service kinds
    { id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", kind: "embedding" },
    { id: "nvidia/parakeet-ctc-1.1b-asr", name: "Parakeet CTC 1.1B", params: ["language"], kind: "stt" },
    { id: "fastpitch", name: "FastPitch", kind: "tts" },
    { id: "tacotron2", name: "Tacotron2", kind: "tts" },
  ],
  serviceKinds: ["llm","tts","stt","embedding"],
  ttsConfig: {
    baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech",
    authType: "apikey",
    authHeader: "bearer",
    format: "nvidia-tts",
  },
  embeddingConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authType: "apikey", authHeader: "bearer" },
};
