// Zed provider — RSA keypair callback auth (NOT standard OAuth).
// Source of truth: .repo/cockpit-tools/src-tauri/src/modules/zed_oauth.rs + zed_account.rs.
export default {
  id: "zed",
  priority: 10,
  alias: "zd",
  uiAlias: "zd",
  display: {
    name: "Zed",
    icon: "code",
    color: "#A855F7",
    website: "https://zed.dev",
    notice: {
      signupUrl: "https://zed.dev/native_app_signin",
    },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,

  transport: {
    // Zed hosted LLM aggregator (OmniRoute-verified): cloud.zed.dev/completions is a
    // multi-format proxy fronting Anthropic/OpenAI/Google/xAI depending on the model.
    // Wire protocol = NDJSON/SSE-ish stream authenticated with a short-lived LLM bearer
    // token exchanged from the RSA-decrypted access_token (see open-sse/shared/zedAuth
    // in OmniRoute). cockpit-tools only covered the RSA login + cloud.zed.dev quota path.
    baseUrl: "https://cloud.zed.dev/completions",
    format: "openai",
    forceStream: true,
    headers: {
      "content-type": "application/json",
    },
    // Auth scheme is non-standard: "Authorization: <user_id> <access_token>" plus a duplicate
    // x-zed-cloud-token header (verified in zed_account.rs build_authorization_header +
    // cloud fetch). Executor builds both; scheme here is a marker for config-driven tooling.
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "<user_id> <access_token>", // placeholder — real value built in executor
    },
    usage: {
      url: "https://cloud.zed.dev/client/users/me", // verified in zed_account.rs
    },
    // Live catalog discovery — Zed's hosted model list changes frequently and is fetched
    // per-connection rather than hardcoded (OmniRoute pattern).
    modelsUrl: "https://cloud.zed.dev/models",
  },

  // Empty static catalog + passthrough: Zed fronts a rotating set of upstream models
  // (Claude/GPT/Gemini/Grok). Resolved live via modelsUrl; any client-sent model id is
  // forwarded as-is rather than validated against a frozen list.
  models: [],
  passthroughModels: true,

  oauth: {
    // Zed auth flow is RSA-based, NOT OAuth2/PKCE:
    //   1. App generates RSA-2048 keypair locally (PKCS#1 DER, URL-safe base64).
    //   2. Bind random TCP port on 127.0.0.1.
    //   3. Open https://zed.dev/native_app_signin?native_app_port={port}&native_app_public_key={pub}.
    //   4. After login, browser redirects http://127.0.0.1:{port}/?user_id=...&access_token=...
    //      where access_token = base64(RSA-encrypted plaintext token).
    //   5. Decrypt with private key (OAEP-SHA256, fallback PKCS1v15). Store user_id + plaintext token.
    // No clientId/clientSecret/tokenUrl/refreshUrl — long-lived access_token, no refresh.
    authorizeUrl: "https://zed.dev/native_app_signin",
    platform: "zed",
    rsaKeyExchange: true, // new flag: signals frontend/router this flow needs local RSA + TCP listener.
  },

  features: {
    usage: true,
  },
};
