export default {
  id: "fal-ai",
  priority: 90,
  hasFree: true,
  alias: "fal-ai",
  aliases: [
    "fal",
  ],
  uiAlias: "fal",
  display: {
    name: "Fal.ai",
    icon: "image",
    color: "#2563EB",
    textIcon: "FL",
    website: "https://fal.ai",
    notice: {
      apiKeyUrl: "https://fal.ai/dashboard/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "fal-ai/flux/schnell", name: "FLUX Schnell", params: ["n","size"], kind: "image" },
    { id: "fal-ai/flux/dev", name: "FLUX Dev", params: ["n","size"], kind: "image" },
    { id: "fal-ai/flux-pro/v1.1", name: "FLUX Pro v1.1", params: ["n","size"], kind: "image" },
    { id: "fal-ai/flux-pro/v1.1-ultra", name: "FLUX Pro v1.1 Ultra", params: ["n","size"], kind: "image" },
    { id: "fal-ai/recraft-v3", name: "Recraft V3", params: ["n","size","style"], kind: "image" },
    { id: "fal-ai/ideogram/v2", name: "Ideogram V2", params: ["n","size","style"], kind: "image" },
    { id: "fal-ai/stable-diffusion-v35-large", name: "SD 3.5 Large", params: ["n","size"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://queue.fal.run" },
};
