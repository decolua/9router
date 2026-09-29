export default {
  id: "bedrock",
  alias: "br",
  aliases: ["aws-bedrock"],
  uiAlias: "br",
  category: "apikey",
  authType: "apikey",
  // In profile/SSO mode the connection carries no API key at all — the credential lives in the
  // local AWS config. This names the providerSpecificData field that stands in for one, so the
  // create and validate routes accept an empty key instead of rejecting the documented setup.
  apiKeyOptionalWith: "profile",
  // Which credential form the dashboard should render. Declared rather than keyed off the
  // provider id, because gating the form on `provider === "bedrock"` silently left every later
  // AWS entry with no way to enter a profile at all.
  credentialForm: "aws",
  display: {
    name: "AWS Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text:
        "Two ways to authenticate, both entered in the AWS Bedrock Credentials section below. " +
        "SSO / profile (recommended): fill in Profile and Region, leave the API key empty, then " +
        "run `aws sso login --profile <name>` — credentials refresh automatically. " +
        "Static keys: put the AWS secret access key in the API Key field and the key id in " +
        "Access Key ID, adding Session Token if they are temporary (ASIA…) keys. " +
        "A profile, if set, takes precedence over static keys.",
      apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
  },
  transport: {
    // Region is substituted per request in executors/bedrock.js; this value documents the shape.
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    // Anthropic models on Bedrock accept the Anthropic Messages body verbatim, so the existing
    // claude translators are reused rather than adding a Bedrock-specific pair.
    format: "claude",
    // SigV4 is computed per request from the resolved credentials; there is no static header.
    auth: { header: "aws-sigv4", scheme: "raw" },
    // Deliberately NOT forceStream. Bedrock has a real non-streaming endpoint (/invoke) that
    // returns a complete Anthropic Messages response, and forcing streaming sent non-stream
    // clients through handleForcedSSEToJson (chatCore.js:482), which returned an empty
    // `content` with Claude-shaped usage leaking into the OpenAI envelope.
  },
  // Every Anthropic model on Bedrock is INFERENCE_PROFILE-only: the bare `anthropic.*` ids
  // cannot be invoked on demand, so the cross-region profile ids (`us.` / `global.` prefix) are
  // what belong here. This list was read from a live ListInferenceProfiles call, but which
  // profiles an account has ACTIVE varies by account and region, so any id is allowed through.
  passthroughModels: true,
  models: [
    { id: "us.anthropic.claude-opus-5", name: "Claude Opus 5" },
    { id: "us.anthropic.claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "us.anthropic.claude-fable-5", name: "Claude Fable 5" },
    { id: "us.anthropic.claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "us.anthropic.claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "us.anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    {
      id: "us.anthropic.claude-opus-4-5-20251101-v1:0",
      name: "Claude Opus 4.5",
    },
    {
      id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      name: "Claude Sonnet 4.5",
    },
    {
      id: "us.anthropic.claude-opus-4-1-20250805-v1:0",
      name: "Claude Opus 4.1",
    },
    {
      id: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      name: "Claude Sonnet 4",
    },
    { id: "us.anthropic.claude-3-haiku-20240307-v1:0", name: "Claude 3 Haiku" },
  ],
  hasProviderSpecificData: true,
};
