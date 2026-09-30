export default {
  id: "gemini-web",
  priority: 141,
  alias: "gemini-web",
  aliases: [
    "gweb",
    "gemini-cookie",
  ],
  uiAlias: "gweb",
  display: {
    name: "Gemini Web",
    icon: "bolt",
    color: "#1C7DFF",
    textIcon: "GW",
    website: "https://gemini.google.com",
    notice: {
      apiKeyUrl: "https://gemini.google.com",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-1PSID cookie (plus __Secure-1PSIDTS) from gemini.google.com (DevTools -> Application -> Cookies)",
  transport: {
    baseUrl: "https://gemini.google.com/app",
    format: "gemini-web",
    authType: "cookie",
  },
  models: [
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
  ],
  passthroughModels: true,
};
