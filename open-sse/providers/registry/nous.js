import {
  NOUS_AGENT_KEY_URL,
  NOUS_CHAT_COMPLETIONS_URL,
  NOUS_DEVICE_CODE_URL,
  NOUS_MODELS_URL,
  NOUS_OAUTH_CLIENT_ID,
  NOUS_OAUTH_SCOPE,
  NOUS_PORTAL_BASE_URL,
  NOUS_TOKEN_URL,
} from "../../services/nous.js";

const nous = {
  id: "nous",
  priority: 65,
  hasFree: true,
  alias: "nous",
  aliases: ["nous-portal", "nous-research", "ns"],
  uiAlias: "nous",
  display: {
    name: "Nous Research",
    icon: "psychology",
    color: "#7C3AED",
    textIcon: "NR",
    website: "https://nousresearch.com",
    notice: {
      text: "Connect with OAuth Device Code (free account, no payment required) or a Nous Portal API key.",
      signupUrl: "https://portal.nousresearch.com",
      apiKeyUrl: "https://portal.nousresearch.com/api-keys",
    },
  },
  category: "freeTier",
  authType: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: NOUS_CHAT_COMPLETIONS_URL,
    format: "openai",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  oauth: {
    clientId: NOUS_OAUTH_CLIENT_ID,
    portalBaseUrl: NOUS_PORTAL_BASE_URL,
    deviceCodeUrl: NOUS_DEVICE_CODE_URL,
    tokenUrl: NOUS_TOKEN_URL,
    agentKeyUrl: NOUS_AGENT_KEY_URL,
    scope: NOUS_OAUTH_SCOPE,
  },
  models: [
    {
      id: "meituan/longcat-2.0:free",
      name: "Meituan: LongCat 2.0",
      contextLength: 1048756,
      maxOutputTokens: 262144,
    },
    {
      id: "meituan/longcat-2.5-preview:free",
      name: "Meituan: LongCat 2.5 Preview",
      contextLength: 1048576,
      maxOutputTokens: 131072,
    },
    {
      id: "stepfun/step-5-preview:free",
      name: "StepFun: Step 5 Preview",
      contextLength: 1000000,
      maxOutputTokens: 64000,
    },
    {
      id: "upstage/solar-mini4:free",
      name: "Upstage: Solar Mini 4",
      contextLength: 524288,
      maxOutputTokens: 131072,
    },
    {
      id: "stepfun/step-3.7-flash:free",
      name: "StepFun: Step 3.7 Flash",
      contextLength: 262144,
      maxOutputTokens: 256000,
    },
    {
      id: "poolside/laguna-s-2.1:free",
      name: "Poolside: Laguna S 2.1",
      contextLength: 262144,
      maxOutputTokens: 131072,
    },
    {
      id: "poolside/laguna-xs-2.1:free",
      name: "Poolside: Laguna XS 2.1",
      contextLength: 262144,
      maxOutputTokens: 32768,
    },
    {
      id: "stealth/missingno",
      name: "MissingNo",
      contextLength: 262144,
      maxOutputTokens: 131072,
    },
  ],
  serviceKinds: ["llm", "imageToText"],
  modelsFetcher: { url: NOUS_MODELS_URL, type: "nous-free" },
  passthroughModels: true,
};

export default nous;
