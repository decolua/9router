// Z.ai (chat.z.ai) — token-based reverse of the international consumer web chat.
//
// chat.z.ai is Zhipu's international consumer web app (the China-side twin,
// chatglm.cn, was retired from this repo in favor of this provider). Unlike
// cookie-based web providers, Z.ai authenticates with a single Local Storage
// "token" (JWT) — no Cookie header is sent. The ZaiWebExecutor
// (open-sse/executors/zai-web.js) bridges this to an OpenAI-compatible
// interface by:
//   1. resolving the deployed frontend version (cached, 15 min TTL)
//   2. creating a chat via POST /api/v1/chats/new
//   3. POSTing to /api/v2/chat/completions with a per-request HMAC signature
//      (X-Signature) + X-FE-Version headers
//   4. translating the z.ai SSE frames (internal envelope + OpenAI-shaped)
//      into OpenAI chat.completion.chunk frames
//
// Auth input: the raw "token" value from chat.z.ai Local Storage
//   (DevTools → Application → Local Storage → chat.z.ai → "token").
// A JSON credential ({ "token": "...", "captcha_verify_param": "..." }),
// "Bearer ...", "token=..." or a bare JWT are also accepted — the access
// token is used as-is (no refresh exchange like chatglm.cn).
//
// Protocol reference: OmniRoute open-sse/executors/zai-web (audited PR #10329 —
// validation semantics + signature/SSE protocol ported 1:1).
export default {
  id: "zai-web",
  priority: 60,
  alias: "zai-web",
  uiAlias: "zai-web",
  display: {
    name: "Z.ai Web",
    icon: "auto_awesome",
    color: "#2563EB",
    textIcon: "Z.ai",
    website: "https://chat.z.ai",
    notice: {
      signupUrl: "https://chat.z.ai",
      apiKeyUrl: "https://chat.z.ai",
      text: "Z.ai free web chat (GLM-5.2, GLM-5.1, GLM-5-Turbo, GLM-5V-Turbo). Open chat.z.ai, log in, then copy the \"token\" value from DevTools → Application → Local Storage → chat.z.ai and paste it here — do NOT copy cookies; the token is what the executor authenticates with. A JSON credential including captcha_verify_param is accepted when a CAPTCHA challenge is active.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint:
    'Copy the "token" value from chat.z.ai → DevTools → Application → Local Storage → chat.z.ai and paste it (raw value, or a JSON credential with captcha_verify_param when challenged). Do not copy cookies.',
  transport: {
    // Base of the Z.ai web app. The executor builds full per-call URLs from this.
    baseUrl: "https://chat.z.ai",
    format: "zai-web",
    authType: "cookie",
  },
  // Z.ai web models (capability-verified against chat.z.ai prod-fe-1.1.79).
  models: [
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5-turbo", name: "GLM-5 Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5V Turbo" },
  ],
  passthroughModels: true,
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
};
