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
  // Static fallback; the live catalog comes from GetCliModelConfigs per connection.
  models: [
    { id: "swe-2-high", name: "SWE-2 High", contextLength: 262144 },
    { id: "swe-2-medium", name: "SWE-2 Medium", contextLength: 262144 },
    { id: "swe-2-max", name: "SWE-2 Max", contextLength: 262144 },
    { id: "swe-1-7", name: "SWE-1.7" },
    { id: "swe-1-7-medium", name: "SWE-1.7 Medium" },
    { id: "swe-1-7-lightning", name: "SWE-1.7 Lightning" },
    { id: "swe-1-6", name: "SWE-1.6" },
    { id: "swe-1-6-fast", name: "SWE-1.6 Fast" },
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
