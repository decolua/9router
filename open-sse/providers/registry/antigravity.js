import { ANTIGRAVITY_IDE_BASE_URL, ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_OAUTH_CLIENT } from "../shared.js";

export default {
  id: "antigravity",
  priority: 20,
  alias: "ag",
  uiAlias: "ag",
  display: {
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    website: "https://antigravity.google",
    notice: {
      signupUrl: "https://antigravity.google",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  serviceKinds: ["llm", "image"],
  transport: {
    baseUrls: [ANTIGRAVITY_IDE_BASE_URL],
    format: "antigravity",
    headers: {
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
    },
    retry: {
      "429": {
        attempts: 3,
      },
      "500": {
        attempts: 3,
      },
      "503": {
        attempts: 3,
      },
    },
    usage: {
      // Discovery (quota/project) on PROD; daily host rejects these.
      quotaApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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",
  },
  // Antigravity's ids are the clearest case for declared identity: the effort token
  // is spelled three different ways across one list ("-high", "-extra-low", and
  // "-agent" for the top tier), and the display names are the vendor's real ladder.
  // Where an id token and the display name disagree, the display name wins - it is
  // the tier the vendor actually sells.
  models: [
    // 3.7 Flash comes from upstream v0.5.55. The family/effort keys are ours:
    // without them a tiered variant matches no bench key and stays invisible to
    // every combo, which is the same defect the gemini-pro-agent comment below
    // records. Added here so the new models are not silently unrankable.
    { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", upstreamModelId: "gemini-3.7-flash-tiered(high)", family: "gemini-3.7-flash", effort: "high" },
    { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", upstreamModelId: "gemini-3.7-flash-tiered(medium)", family: "gemini-3.7-flash", effort: "medium" },
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", upstreamModelId: "gemini-3.7-flash-tiered(low)", family: "gemini-3.7-flash", effort: "low" },
    { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)", upstreamModelId: "gemini-3.6-flash-tiered(high)", family: "gemini-3.6-flash", effort: "high" },
    { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)", upstreamModelId: "gemini-3.6-flash-tiered(medium)", family: "gemini-3.6-flash", effort: "medium" },
    { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)", upstreamModelId: "gemini-3.6-flash-tiered(low)", family: "gemini-3.6-flash", effort: "low" },
    { id: "gemini-3.5-flash-high", name: "Gemini 3.5 Flash (High)", family: "gemini-3.5-flash", effort: "high" },
    { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)", family: "gemini-3.5-flash", effort: "high" },
    { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)", family: "gemini-3.5-flash", effort: "medium" },
    { id: "gemini-3.5-flash-extra-low", name: "Gemini 3.5 Flash (Low)", family: "gemini-3.5-flash", effort: "low" },
    // `gemini-pro-agent` is the HIGH variant of gemini-3.1-pro. Nothing in the id
    // says so, which is why it used to match no bench key and stayed invisible to
    // every combo while the LOW variant below inherited the full model's band.
    { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", family: "gemini-3.1-pro", effort: "high" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", family: "gemini-3.1-pro", effort: "low" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", family: "claude-sonnet-4-6", mode: "thinking" },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", family: "claude-opus-4-6-thinking", mode: "thinking" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", family: "gpt-oss-120b", effort: "medium" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash", thinking: false, family: "gemini-3-flash" },
    // Image generation models
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash (Image)", kind: "image", imageGen: true, capabilities: ["textToImage"] },
  ],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    apiEndpoint: "https://daily-cloudcode-pa.googleapis.com",
    apiVersion: "v1internal",
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    onboardUserEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    loadCodeAssistUserAgent: ANTIGRAVITY_IDE_USER_AGENT,
    refreshLeadMs: 300000,
  },
  features: {
    usage: true,
  },
};
