export default {
  id: "vertex",
  priority: 40,
  alias: "vertex",
  aliases: [
    "vx",
  ],
  uiAlias: "vx",
  display: {
    name: "Vertex AI",
    icon: "cloud",
    color: "#4285F4",
    textIcon: "VX",
    website: "https://cloud.google.com/vertex-ai",
    notice: {
      text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.",
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "vertex",
  },
  models: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "veo-3.1-generate-preview", name: "Veo 3.1 (Preview)", params: ["duration","aspect_ratio","resolution","negative_prompt","seed","storage_uri","generate_audio"], kind: "video" },
    { id: "veo-3.1-fast-generate-preview", name: "Veo 3.1 Fast (Preview)", params: ["duration","aspect_ratio","resolution","negative_prompt","seed","storage_uri","generate_audio"], kind: "video" },
    { id: "veo-3.0-generate-001", name: "Veo 3", params: ["duration","aspect_ratio","resolution","negative_prompt","seed","storage_uri","generate_audio"], kind: "video" },
    { id: "veo-2.0-generate-001", name: "Veo 2", params: ["duration","aspect_ratio","negative_prompt","seed","storage_uri"], kind: "video" },
  ],
  serviceKinds: ["llm","imageToText","video"],
  // Veo via predictLongRunning + fetchPredictOperation (adapter: handlers/videoProviders/vertex.js).
  // Docs: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation
  videoConfig: { baseUrl: "https://aiplatform.googleapis.com" },
};
