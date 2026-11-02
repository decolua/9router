export default {
  id: "bedrock-xai",
  alias: "brx",
  aliases: ["bedrock-grok"],
  uiAlias: "brx",
  category: "apikey",
  authType: "apikey",
  // Same credential story as `bedrock`: in profile/SSO mode there is no API key to paste.
  apiKeyOptionalWith: "profile",
  // Which credential form the dashboard should render. Declared rather than keyed off the
  // provider id, because gating the form on `provider === "bedrock"` silently left every later
  // AWS entry with no way to enter a profile at all.
  credentialForm: "aws",
  display: {
    name: "AWS Bedrock (xAI)",
    icon: "cloud",
    // AWS orange, so the card still reads as Bedrock; the xAI mark distinguishes it from the
    // Anthropic-model entry.
    color: "#FF9900",
    textIcon: "BX",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text:
        "xAI Grok models hosted on AWS Bedrock. Authenticate exactly like the AWS Bedrock " +
        "provider: fill in Profile and Region and leave the API key empty, then run " +
        "`aws sso login --profile <name>`; or use static keys with the AWS secret access key " +
        "as the API key. Note Grok is a reasoning model and spends output budget thinking " +
        'before it answers — a small max_tokens returns finish_reason "length" with empty ' +
        "content, so allow a few thousand tokens.",
      apiKeyUrl:
        "https://console.aws.amazon.com/iam/home#/security_credentials",
    },
  },
  transport: {
    // Region is substituted per request in executors/bedrock.js; this documents the shape.
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",
    // No `format` on purpose: it defaults to "openai" (providers/schema.js), which is what Grok
    // on Bedrock actually speaks. Verified live — /invoke ignores `anthropic_version` and returns
    // a Chat Completions body, and the streaming frames carry chat.completion.chunk payloads.
    // So the existing OpenAI translators apply and the response needs no translation at all.
    auth: { header: "aws-sigv4", scheme: "raw" },
  },
  // Like `bedrock`: which ids an account can call varies by region and enabled inference
  // profiles, so anything is allowed through and only the known-live ones are listed.
  passthroughModels: true,
  models: [
    { id: "us.xai.grok-4.6", name: "Grok 4.6" },
    { id: "global.xai.grok-4.6", name: "Grok 4.6 (global)" },
  ],
  hasProviderSpecificData: true,
};
