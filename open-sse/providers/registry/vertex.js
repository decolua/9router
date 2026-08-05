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
  regions: [
    { id: "us-central1", label: "us-central1 (Iowa)" },
    { id: "us-east4", label: "us-east4 (Northern Virginia)" },
    { id: "us-west1", label: "us-west1 (Oregon)" },
    { id: "europe-west1", label: "europe-west1 (Belgium)" },
    { id: "europe-west4", label: "europe-west4 (Netherlands)" },
    { id: "asia-east1", label: "asia-east1 (Taiwan)" },
    { id: "asia-northeast1", label: "asia-northeast1 (Tokyo)" },
    { id: "asia-southeast1", label: "asia-southeast1 (Singapore)" },
    { id: "global", label: "global (Global)" },
  ],
  defaultRegion: "us-central1",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "vertex",
  },
  models: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  serviceKinds: ["llm","imageToText"],
};
