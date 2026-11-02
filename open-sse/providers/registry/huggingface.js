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
    { id: "black-forest-labs/FLUX.1-Krea-dev", name: "FLUX.1 Krea", params: [], kind: "image" },
    { id: "black-forest-labs/FLUX.1-Kontext-dev", name: "FLUX.1 Kontext", params: [], kind: "image", capabilities: ["edit"] },
    { id: "black-forest-labs/FLUX.2-dev", name: "FLUX.2 Dev", params: [], kind: "image", capabilities: ["edit"] },
    { id: "black-forest-labs/FLUX.2-klein-9B", name: "FLUX.2 Klein 9B", params: [], kind: "image", capabilities: ["edit"] },
    { id: "black-forest-labs/FLUX.2-klein-4B", name: "FLUX.2 Klein 4B", params: [], kind: "image", capabilities: ["edit"] },
    { id: "black-forest-labs/FLUX.2-klein-base-9B", name: "FLUX.2 Klein Base 9B", params: [], kind: "image", capabilities: ["edit"] },
    { id: "black-forest-labs/FLUX.2-klein-base-4B", name: "FLUX.2 Klein Base 4B", params: [], kind: "image", capabilities: ["edit"] },
    { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", params: [], kind: "image" },
    { id: "stabilityai/stable-diffusion-3.5-large", name: "Stable Diffusion 3.5 Large", params: [], kind: "image" },
    { id: "stabilityai/stable-diffusion-3.5-large-turbo", name: "Stable Diffusion 3.5 Large Turbo", params: [], kind: "image" },
    { id: "Qwen/Qwen-Image", name: "Qwen Image", params: [], kind: "image" },
    { id: "Qwen/Qwen-Image-2512", name: "Qwen Image 2512", params: [], kind: "image" },
    { id: "Qwen/Qwen-Image-Edit", name: "Qwen Image Edit", params: [], kind: "image", capabilities: ["edit"] },
    { id: "Qwen/Qwen-Image-Edit-2509", name: "Qwen Image Edit 2509", params: [], kind: "image", capabilities: ["edit"] },
    { id: "Qwen/Qwen-Image-Edit-2511", name: "Qwen Image Edit 2511", params: [], kind: "image", capabilities: ["edit"] },
    { id: "ideogram-ai/ideogram-4-fp8", name: "Ideogram 4", params: [], kind: "image" },
    { id: "tencent/HunyuanImage-3.0", name: "HunyuanImage 3.0", params: [], kind: "image" },
    { id: "Tongyi-MAI/Z-Image-Turbo", name: "Z-Image Turbo", params: [], kind: "image" },
    { id: "krea/Krea-2-Turbo", name: "Krea 2 Turbo", params: [], kind: "image" },
    { id: "HiDream-ai/HiDream-I1-Fast", name: "HiDream I1 Fast", params: [], kind: "image" },
    { id: "playgroundai/playground-v2.5-1024px-aesthetic", name: "Playground v2.5", params: [], kind: "image" },
    { id: "openai/whisper-large-v3", name: "Whisper Large v3 (HF)", params: [], kind: "stt" },
    { id: "openai/whisper-large-v3-turbo", name: "Whisper Large v3 Turbo (HF)", params: [], kind: "stt" },
  ],
  serviceKinds: ["image", "stt"],
  // Inference Providers router. The router is addressed as
  // `<baseUrl>/<provider>/<providerModelId>` — see open-sse/handlers/imageProviders/huggingface.js.
  // `modelMap` resolves a Hub model id to the provider-resolved id the router expects.
  // A plain string value is the provider path. Image-to-image models use
  // `{ path, task: "image-to-image" }`: their payload differs — the source image goes in
  // `inputs` and the prompt under `parameters.prompt`. See
  // https://huggingface.co/docs/inference-providers/tasks/image-to-image
  // Only providers the router actually forwards to are listed: replicate, wavespeed and
  // deepinfra appear in the Hub's inferenceProviderMapping but reject router traffic with
  // "Model not supported by provider <name>".
  imageConfig: {
    baseUrl: "https://router.huggingface.co",
    modelMap: {
      "black-forest-labs/FLUX.1-schnell": "fal-ai/fal-ai/flux/schnell",
      "black-forest-labs/FLUX.1-dev": "fal-ai/fal-ai/flux/dev",
      "black-forest-labs/FLUX.1-Krea-dev": "fal-ai/fal-ai/flux/krea",
      "black-forest-labs/FLUX.1-Kontext-dev": { path: "fal-ai/fal-ai/flux-kontext/dev", task: "image-to-image" },
      "black-forest-labs/FLUX.2-dev": { path: "fal-ai/fal-ai/flux-2/edit", task: "image-to-image" },
      "black-forest-labs/FLUX.2-klein-9B": { path: "fal-ai/fal-ai/flux-2/klein/9b/edit", task: "image-to-image" },
      "black-forest-labs/FLUX.2-klein-4B": { path: "fal-ai/fal-ai/flux-2/klein/4b/distilled/edit", task: "image-to-image" },
      "black-forest-labs/FLUX.2-klein-base-9B": { path: "fal-ai/fal-ai/flux-2/klein/9b/base/edit", task: "image-to-image" },
      "black-forest-labs/FLUX.2-klein-base-4B": { path: "fal-ai/fal-ai/flux-2/klein/4b/base/edit", task: "image-to-image" },
      "stabilityai/stable-diffusion-xl-base-1.0": "fal-ai/fal-ai/fast-sdxl",
      "stabilityai/stable-diffusion-3.5-large": "fal-ai/fal-ai/stable-diffusion-v35-large",
      "stabilityai/stable-diffusion-3.5-large-turbo": "fal-ai/fal-ai/stable-diffusion-v35-large/turbo",
      "Qwen/Qwen-Image": "fal-ai/fal-ai/qwen-image",
      "Qwen/Qwen-Image-2512": "fal-ai/fal-ai/qwen-image-2512",
      "Qwen/Qwen-Image-Edit": { path: "fal-ai/fal-ai/qwen-image-edit", task: "image-to-image" },
      "Qwen/Qwen-Image-Edit-2509": { path: "fal-ai/fal-ai/qwen-image-edit-2509", task: "image-to-image" },
      "Qwen/Qwen-Image-Edit-2511": { path: "fal-ai/fal-ai/qwen-image-edit-plus", task: "image-to-image" },
      "ideogram-ai/ideogram-4-fp8": "fal-ai/ideogram/v4",
      "tencent/HunyuanImage-3.0": "fal-ai/fal-ai/hunyuan-image/v3/text-to-image",
      "Tongyi-MAI/Z-Image-Turbo": "fal-ai/fal-ai/z-image/turbo",
      "krea/Krea-2-Turbo": "fal-ai/fal-ai/krea-2/turbo",
      "HiDream-ai/HiDream-I1-Fast": "fal-ai/fal-ai/hidream-i1-fast",
      "playgroundai/playground-v2.5-1024px-aesthetic": "fal-ai/fal-ai/playground-v25",
    },
  },
  // Speech-to-text goes through the hf-inference provider, which keeps the Hub
  // model id as its provider-resolved id (`/hf-inference/models/<hubId>`).
  // No `params` are declared: the router's ASR payload carries only `inputs` and
  // `parameters.return_timestamps` / `parameters.generation_parameters` — it has no
  // language field, so a UI-declared "language" would be silently dropped.
  sttConfig: {
    baseUrl: "https://router.huggingface.co/hf-inference/models",
    authType: "apikey",
    authHeader: "bearer",
    format: "huggingface-asr",
  },
};
