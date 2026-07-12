/**
 * Grok CLI / Grok Build (cli-chat-proxy.grok.com)
 *
 * Source of truth: HAR capture of official grok-shell/grok-pager 0.2.93
 * talking to https://cli-chat-proxy.grok.com (OpenAI Responses API).
 *
 * Distinct from:
 *  - `xai`      → api.x.ai (API key / Grok Build OAuth PKCE)
 *  - `grok-web` → grok.com web SSO cookie
 */
export default {
  id: "grok-cli",
  priority: 275,
  alias: "gcli",
  aliases: ["grok-build", "gb"],
  uiAlias: "gcli",
  display: {
    name: "Grok CLI (Grok Build)",
    icon: "auto_awesome",
    color: "#1DA1F2",
    textIcon: "GC",
    website: "https://x.ai",
    notice: {
      text: "Sign in with your xAI / Grok account via device code. Uses Grok Build subscription credits (cli-chat-proxy.grok.com).",
      signupUrl: "https://grok.com/supergrok",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  thinkingConfig: {
    options: ["low", "medium", "high"],
    defaultMode: "high",
  },
  transport: {
    baseUrl: "https://cli-chat-proxy.grok.com/v1/responses",
    format: "openai-responses",
    forceStream: true,
    modelsUrl: "https://cli-chat-proxy.grok.com/v1/models",
    userUrl: "https://cli-chat-proxy.grok.com/v1/user",
    billingUrl: "https://cli-chat-proxy.grok.com/v1/billing",
    clientVersion: "0.2.93",
    clientIdentifier: "grok-pager",
    tokenAuth: "xai-grok-cli",
    headers: {
      "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      "x-xai-token-auth": "xai-grok-cli",
      "x-grok-client-identifier": "grok-pager",
      "x-grok-client-version": "0.2.93",
      "x-authenticateresponse": "authenticate-response",
    },
    // Compaction threshold mirrored from CLI (x-compaction-at)
    compactionAt: 400000,
    // Quota tracker: official CLI polls billing?format=credits + user?include=subscription
    usage: {
      url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      userUrl: "https://cli-chat-proxy.grok.com/v1/user?include=subscription",
    },
    retry: {
      429: { attempts: 2, delayMs: 2000 },
      502: { attempts: 2, delayMs: 1500 },
      503: { attempts: 2, delayMs: 1500 },
    },
  },
  models: [
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-4.5-high", name: "Grok 4.5 (High)", upstreamModelId: "grok-4.5" },
    { id: "grok-4.5-medium", name: "Grok 4.5 (Medium)", upstreamModelId: "grok-4.5" },
    { id: "grok-4.5-low", name: "Grok 4.5 (Low)", upstreamModelId: "grok-4.5" },
  ],
  features: {
    usage: true,
  },
  oauth: {
    // Same public client_id as Grok CLI / existing xai OAuth
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    deviceCodeUrl: "https://auth.x.ai/oauth2/device/code",
    tokenUrl: "https://auth.x.ai/oauth2/token",
    refreshUrl: "https://auth.x.ai/oauth2/token",
    // HAR scope includes conversations read/write beyond the api-only xai scope
    scope:
      "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
    referrer: "grok-build",
    refreshLeadMs: 5 * 60 * 1000,
  },
};
