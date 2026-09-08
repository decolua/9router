export default {
  id: "string-web-access",
  alias: "string-web-access",
  display: {
    name: "String Web Access",
    icon: "language",
    color: "#0647D4",
    textIcon: "ST",
    website: "https://usestring.ai/web-access",
    notice: {
      apiKeyUrl: "https://portal.usestring.ai/settings"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webFetch"
  ],
  fetchConfig: {
    baseUrl: "https://request.usestring.ai/v1/fetch",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    formats: [
      "markdown"
    ],
    maxCharacters: 200000,
    timeoutMs: 30000
  }
};
