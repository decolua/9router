export default {
  id: "huggingface",
  priority: 70,
  hasFree: true,
  alias: "huggingface",
  aliases: [
    "hf",
  ],
  uiAlias: "hf",
  display: {
    name: "HuggingFace",
    icon: "face",
    color: "#FFD21E",
    textIcon: "HF",
    website: "https://huggingface.co",
    notice: {
      apiKeyUrl: "https://huggingface.co/settings/tokens",
      text: "Runs through the Inference Providers router. Image and speech models are billed by the provider selected per model.",
    },
  },
  category: "apikey",
  authType: "apikey",
  hiddenKinds: [
    "tts",
  ],
  transport: null,
  models: [
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell", params: [], kind: "image" },
    { id: "black-forest-labs/FLUX.1-dev", name: "FLUX.1 Dev", params: [], kind: "image" },
    { id: "black-forest-labs/FLUX.2-dev", name: "FLUX.2 Dev", params: [], kind: "image" },
    { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", params: [], kind: "image" },
    { id: "stabilityai/stable-diffusion-3.5-large", name: "Stable Diffusion 3.5 Large", params: [], kind: "image" },
    { id: "Qwen/Qwen-Image", name: "Qwen Image", params: [], kind: "image" },
    { id: "Qwen/Qwen-Image-Edit", name: "Qwen Image Edit", params: [], kind: "image" },
    { id: "tencent/HunyuanImage-3.0", name: "HunyuanImage 3.0", params: [], kind: "image" },
    { id: "openai/whisper-large-v3", name: "Whisper Large v3 (HF)", params: ["language"], kind: "stt" },
    { id: "openai/whisper-large-v3-turbo", name: "Whisper Large v3 Turbo (HF)", params: ["language"], kind: "stt" },
  ],
  serviceKinds: ["image", "stt"],
  // Inference Providers router. The router is addressed as
  // `<baseUrl>/<provider>/<providerModelId>` — see open-sse/handlers/imageProviders/huggingface.js.
  // `modelMap` resolves a Hub model id to the provider-resolved id the router expects.
  // Only providers the router actually forwards to are listed: replicate, wavespeed and
  // deepinfra appear in the Hub's inferenceProviderMapping but reject router traffic with
  // "Model not supported by provider <name>".
  // Source: https://huggingface.co/api/models/<hubId>?expand[]=inferenceProviderMapping
  imageConfig: {
    baseUrl: "https://router.huggingface.co",
    modelMap: {
      "black-forest-labs/FLUX.1-schnell": "fal-ai/fal-ai/flux/schnell",
      "black-forest-labs/FLUX.1-dev": "fal-ai/fal-ai/flux/dev",
      "black-forest-labs/FLUX.2-dev": "fal-ai/fal-ai/flux-2/edit",
      "stabilityai/stable-diffusion-xl-base-1.0": "fal-ai/fal-ai/fast-sdxl",
      "stabilityai/stable-diffusion-3.5-large": "fal-ai/fal-ai/stable-diffusion-v35-large",
      "Qwen/Qwen-Image": "fal-ai/fal-ai/qwen-image",
      "Qwen/Qwen-Image-Edit": "fal-ai/fal-ai/qwen-image-edit",
      "tencent/HunyuanImage-3.0": "fal-ai/fal-ai/hunyuan-image/v3/text-to-image",
    },
  },
  // Speech-to-text goes through the hf-inference provider, which keeps the Hub
  // model id as its provider-resolved id (`/hf-inference/models/<hubId>`).
  sttConfig: {
    baseUrl: "https://router.huggingface.co/hf-inference/models",
    authType: "apikey",
    authHeader: "bearer",
    format: "huggingface-asr",
  },
};
