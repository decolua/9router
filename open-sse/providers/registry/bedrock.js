export default {
  id: "bedrock",
  priority: 35,
  alias: "bedrock",
  display: {
    name: "Amazon Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text: "Use your AWS Secret Access Key as the API key, and set the Access Key ID plus region in provider settings. Requests are signed with SigV4.",
      apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasProviderSpecificData: true,
  // Region-dynamic host, resolved in BedrockExecutor.buildUrl.
  transport: {
    baseUrl: "",
    format: "claude",
    headers: {},
  },
  regions: [
    { id: "us-east-1", label: "US East (N. Virginia)" },
    { id: "us-east-2", label: "US East (Ohio)" },
    { id: "us-west-2", label: "US West (Oregon)" },
    { id: "ca-central-1", label: "Canada (Central)" },
    { id: "eu-central-1", label: "Europe (Frankfurt)" },
    { id: "eu-west-1", label: "Europe (Ireland)" },
    { id: "eu-west-3", label: "Europe (Paris)" },
    { id: "eu-north-1", label: "Europe (Stockholm)" },
    { id: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
    { id: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
    { id: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
    { id: "ap-south-1", label: "Asia Pacific (Mumbai)" },
    { id: "sa-east-1", label: "South America (São Paulo)" },
  ],
  defaultRegion: "us-east-1",
  // Bedrock does not serve Anthropic base model ids on-demand — every id below
  // carries an inference-profile prefix. Swap "global." for "us."/"eu."/"apac."/
  // "jp."/"au." if you need data residency (10% premium); any other profile id or
  // full inference-profile ARN can be typed in as a custom model.
  models: [
    { id: "global.anthropic.claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "global.anthropic.claude-opus-4-6-v1", name: "Claude Opus 4.6" },
    { id: "global.anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "global.anthropic.claude-opus-4-5-20251101-v1:0", name: "Claude Opus 4.5" },
    { id: "global.anthropic.claude-sonnet-4-5-20250929-v1:0", name: "Claude Sonnet 4.5" },
    { id: "global.anthropic.claude-haiku-4-5-20251001-v1:0", name: "Claude Haiku 4.5" },
  ],
  serviceKinds: ["llm", "imageToText"],
};
