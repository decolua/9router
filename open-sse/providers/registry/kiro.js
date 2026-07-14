const GPT_5_6_CONTEXT_LENGTH = 272_000;

const gpt56 = (id, name, rateMultiplier) => ({
  id,
  name,
  contextLength: GPT_5_6_CONTEXT_LENGTH,
  rateMultiplier,
  upstreamModelId: id,
  description: `Experimental preview of OpenAI ${name} with 272k context window`,
});

const gpt56Variant = (base, suffix, suffixName) => ({
  ...base,
  id: `${base.id}-${suffix}`,
  name: `${base.name} (${suffixName})`,
});

const GPT_5_6_SOL = gpt56("gpt-5.6-sol", "GPT 5.6 Sol", 2.4);
const GPT_5_6_TERRA = gpt56("gpt-5.6-terra", "GPT 5.6 Terra", 1.2);
const GPT_5_6_LUNA = gpt56("gpt-5.6-luna", "GPT 5.6 Luna", 0.6);

export default {
  id: "kiro",
  priority: 10,
  alias: "kr",
  uiAlias: "kr",
  display: {
    name: "Kiro AI",
    icon: "psychology_alt",
    color: "#FF6B35",
    website: "https://kiro.dev",
    notice: {
      signupUrl: "https://kiro.dev",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "free",
  transport: {
    baseUrl: "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
    baseUrls: [
      "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse",
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
    ],
    format: "kiro",
    retry: {
      "429": 0,
    },
    headers: {
      "Content-Type": "application/json",
      Accept: "application/vnd.amazon.eventstream",
      "X-Amz-Target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
      "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
      "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
    },
    tokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authUrl: "https://prod.us-east-1.auth.desktop.kiro.dev",
    usage: {
      cwHost: "https://codewhisperer.us-east-1.amazonaws.com",
      qHost: "https://q.us-east-1.amazonaws.com",
      limitsPath: "/getUsageLimits",
    },
  },
  models: [
    // Opus (added per kiro.dev/changelog/models and kiro.dev/docs/models)
    { id: "claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "claude-opus-4.8-thinking", name: "Claude Opus 4.8 (Thinking)" },
    { id: "claude-opus-4.8-agentic", name: "Claude Opus 4.8 (Agentic)" },
    { id: "claude-opus-4.8-thinking-agentic", name: "Claude Opus 4.8 (Thinking + Agentic)" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "claude-opus-4.7-thinking", name: "Claude Opus 4.7 (Thinking)" },
    { id: "claude-opus-4.7-agentic", name: "Claude Opus 4.7 (Agentic)" },
    { id: "claude-opus-4.7-thinking-agentic", name: "Claude Opus 4.7 (Thinking + Agentic)" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-opus-4.5-thinking", name: "Claude Opus 4.5 (Thinking)" },
    { id: "claude-opus-4.5-agentic", name: "Claude Opus 4.5 (Agentic)" },
    { id: "claude-opus-4.5-thinking-agentic", name: "Claude Opus 4.5 (Thinking + Agentic)" },
    // Sonnet
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    // Haiku
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    // Non-Anthropic
    { id: "deepseek-3.2", name: "DeepSeek 3.2", strip: ["image","audio"] },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", strip: ["image","audio"] },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    GPT_5_6_SOL,
    GPT_5_6_TERRA,
    GPT_5_6_LUNA,
    // Thinking variants
    { id: "claude-sonnet-5-thinking", name: "Claude Sonnet 5 (Thinking)" },
    { id: "claude-sonnet-4.5-thinking", name: "Claude Sonnet 4.5 (Thinking)" },
    { id: "claude-haiku-4.5-thinking", name: "Claude Haiku 4.5 (Thinking)" },
    gpt56Variant(GPT_5_6_SOL, "thinking", "Thinking"),
    gpt56Variant(GPT_5_6_TERRA, "thinking", "Thinking"),
    gpt56Variant(GPT_5_6_LUNA, "thinking", "Thinking"),
    // Agentic variants
    { id: "claude-sonnet-5-agentic", name: "Claude Sonnet 5 (Agentic)" },
    { id: "claude-sonnet-4.5-agentic", name: "Claude Sonnet 4.5 (Agentic)" },
    { id: "claude-haiku-4.5-agentic", name: "Claude Haiku 4.5 (Agentic)" },
    gpt56Variant(GPT_5_6_SOL, "agentic", "Agentic"),
    gpt56Variant(GPT_5_6_TERRA, "agentic", "Agentic"),
    gpt56Variant(GPT_5_6_LUNA, "agentic", "Agentic"),
    // Thinking + Agentic variants
    { id: "claude-sonnet-5-thinking-agentic", name: "Claude Sonnet 5 (Thinking + Agentic)" },
    { id: "claude-sonnet-4.5-thinking-agentic", name: "Claude Sonnet 4.5 (Thinking + Agentic)" },
    { id: "claude-haiku-4.5-thinking-agentic", name: "Claude Haiku 4.5 (Thinking + Agentic)" },
    gpt56Variant(GPT_5_6_SOL, "thinking-agentic", "Thinking + Agentic"),
    gpt56Variant(GPT_5_6_TERRA, "thinking-agentic", "Thinking + Agentic"),
    gpt56Variant(GPT_5_6_LUNA, "thinking-agentic", "Thinking + Agentic"),
  ],
  oauth: {
    ssoOidcEndpoint: "https://oidc.us-east-1.amazonaws.com",
    registerClientUrl: "https://oidc.us-east-1.amazonaws.com/client/register",
    deviceAuthUrl: "https://oidc.us-east-1.amazonaws.com/device_authorization",
    tokenUrl: "https://oidc.us-east-1.amazonaws.com/token",
    startUrl: "https://view.awsapps.com/start",
    clientName: "kiro-oauth-client",
    clientType: "public",
    scopes: [
      "codewhisperer:completions",
      "codewhisperer:analysis",
      "codewhisperer:conversations",
    ],
    grantTypes: [
      "urn:ietf:params:oauth:grant-type:device_code",
      "refresh_token",
    ],
    issuerUrl: "https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6",
    socialAuthEndpoint: "https://prod.us-east-1.auth.desktop.kiro.dev",
    socialLoginUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/login",
    socialTokenUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
    socialRefreshUrl: "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken",
    authMethods: [
      "builder-id",
      "idc",
      "google",
      "github",
      "import",
    ],
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
