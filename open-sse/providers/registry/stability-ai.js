export default {
  id: "stability-ai",
  priority: 60,
  alias: "stability-ai",
  aliases: [
    "stability",
  ],
  uiAlias: "stability",
  display: {
    name: "Stability AI",
    icon: "image",
    color: "#8B5CF6",
    textIcon: "SA",
    website: "https://stability.ai",
    notice: {
      apiKeyUrl: "https://platform.stability.ai/account/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "stable-image-ultra", name: "Stable Image Ultra", params: ["size"], kind: "image" },
    { id: "stable-image-core", name: "Stable Image Core", params: ["size","style"], kind: "image" },
    { id: "sd3.5-large", name: "Stable Diffusion 3.5 Large", params: ["size"], kind: "image" },
    { id: "sd3.5-large-turbo", name: "Stable Diffusion 3.5 Large Turbo", params: ["size"], kind: "image" },
    { id: "sd3.5-medium", name: "Stable Diffusion 3.5 Medium", params: ["size"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.stability.ai/v2beta/stable-image/generate" },
};
