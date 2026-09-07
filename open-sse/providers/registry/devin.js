const DEVIN_WEB_URL = "https://app.devin.ai";
const DEVIN_API_URL = "https://api.devin.ai";
const DEVIN_HOST = "https://server.codeium.com";

const devin = {
  id: "devin",
  alias: "dv",
  uiAlias: "dv",
  display: {
    name: "Devin",
    icon: "smart_toy",
    color: "#6366F1",
    textIcon: "DV",
    website: DEVIN_WEB_URL,
    notice: { signupUrl: DEVIN_WEB_URL },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  transport: {
    baseUrl: `${DEVIN_HOST}/exa.api_server_pb.ApiServerService/GetChatMessage`,
    format: "openai",
    forceStream: true,
  },
  models: [
    { id: "swe-1-7", name: "SWE-1.7" },
    { id: "swe-1-6", name: "SWE-1.6" },
  ],
  oauth: {
    authorizeUrl: `${DEVIN_WEB_URL}/auth/cli/continue`,
    tokenUrl: `${DEVIN_API_URL}/auth/cli/token`,
    apiUrl: DEVIN_API_URL,
    host: DEVIN_HOST,
    codeChallengeMethod: "S256",
    callbackPath: "/callback",
    callbackPort: 59653,
    oauthTimeoutMs: 600_000,
  },
};

export default devin;
