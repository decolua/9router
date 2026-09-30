import { GOOGLE_OAUTH_CLIENT } from "../shared.js";

export default {
  id: "gemini-cli",
  priority: 20,
  hasFree: true,
  alias: "gc",
  uiAlias: "gc",
  display: {
    name: "Gemini CLI",
    icon: "terminal",
    color: "#4285F4",
    website: "https://github.com/google-gemini/gemini-cli",
    notice: {
      signupUrl: "https://github.com/google-gemini/gemini-cli",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://cloudcode-pa.googleapis.com/v1internal",
    format: "gemini-cli",
    cliVersion: "0.34.0",
    apiClient: "google-genai-sdk/1.41.0 gl-node/v22.19.0",
    usage: {
      quotaUrl: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      loadCodeAssistUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    },
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: "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",
  },
  models: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    refresh: {
      encoding: "form",
    },
  },
  features: {
    usage: true,
  },
};
