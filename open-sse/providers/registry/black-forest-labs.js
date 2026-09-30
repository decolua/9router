export default {
  id: "black-forest-labs",
  priority: 50,
  alias: "black-forest-labs",
  aliases: [
    "bfl",
  ],
  uiAlias: "bfl",
  display: {
    name: "Black Forest Labs",
    icon: "image",
    color: "#111827",
    textIcon: "BF",
    website: "https://blackforestlabs.ai",
    notice: {
      apiKeyUrl: "https://api.bfl.ai",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: [
    { id: "flux-pro-1.1", name: "FLUX Pro 1.1", params: ["n","size"], kind: "image" },
    { id: "flux-pro-1.1-ultra", name: "FLUX Pro 1.1 Ultra", params: ["size"], kind: "image" },
    { id: "flux-pro", name: "FLUX Pro", params: ["n","size"], kind: "image" },
    { id: "flux-dev", name: "FLUX Dev", params: ["n","size"], kind: "image" },
    { id: "flux-kontext-pro", name: "FLUX Kontext Pro (Edit)", params: ["size"], capabilities: ["edit"], kind: "image" },
    { id: "flux-kontext-max", name: "FLUX Kontext Max (Edit)", params: ["size"], capabilities: ["edit"], kind: "image" },
  ],
  serviceKinds: ["image"],
  imageConfig: { baseUrl: "https://api.bfl.ai/v1" },
};
