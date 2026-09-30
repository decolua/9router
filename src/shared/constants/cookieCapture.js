// Cookie auto-capture metadata — generalizes the Felo capture system to every
// webCookie provider whose auth is a browser session.
//
// The capture button reads the user's logged-in session straight from their
// running Chromium browser (Brave/Chrome/Edge via CDP): it opens a tab on the
// provider's domain, extracts the declared cookies / localStorage / bearer and
// returns a ready-to-paste credential string in the format the provider's
// executor accepts.
//
// Fields:
//   label             — button label ("Capture from …")
//   domains           — origins to open + read cookies from
//   cookies           — named cookies to include (default output: `name=value; …`)
//   fullCookieHeader  — include the ENTIRE cookie jar for the domain instead
//   localStorage      — localStorage keys to read (e.g. deepseek userToken)
//   authorization     — capture the `Authorization` header from API requests
//   mode: "bare"      — output just the primary value instead of `name=value`
//
// Note: felo-web intentionally keeps its own dedicated capture (route +
// profile badge) — do not add it here.

export const COOKIE_CAPTURE = {
  "chatgpt-web": {
    label: "Capture from ChatGPT",
    domains: ["chatgpt.com"],
    cookies: ["__Secure-next-auth.session-token"],
  },
  "claude-web": {
    label: "Capture from Claude",
    domains: ["claude.ai"],
    cookies: ["sessionKey", "cf_clearance"],
  },
  "gemini-web": {
    label: "Capture from Gemini",
    domains: ["gemini.google.com"],
    cookies: ["__Secure-1PSID", "__Secure-1PSIDTS"],
  },
  "deepseek-web": {
    label: "Capture from DeepSeek",
    domains: ["chat.deepseek.com"],
    localStorage: ["userToken"],
    mode: "bare",
  },
  "kimi-web": {
    label: "Capture from Kimi",
    domains: ["www.kimi.com"],
    cookies: ["kimi-auth"],
  },
  "grok-web": {
    label: "Capture from Grok",
    domains: ["grok.com"],
    cookies: ["sso"],
  },
  "poe-web": {
    label: "Capture from Poe",
    domains: ["poe.com"],
    cookies: ["p-b"],
  },
  "perplexity-web": {
    label: "Capture from Perplexity",
    domains: ["perplexity.ai"],
    cookies: ["__Secure-next-auth.session-token"],
  },
  "blackbox-web": {
    label: "Capture from Blackbox",
    domains: ["app.blackbox.ai"],
    cookies: ["next-auth.session-token"],
  },
  "freebuff-web": {
    label: "Capture from FreeBuff",
    domains: ["freebuff.com"],
    cookies: ["__Secure-next-auth.session-token"],
  },
  "muse-spark-web": {
    label: "Capture from Meta AI",
    domains: ["meta.ai"],
    cookies: ["ecto_1_sess"],
  },
  "puter": {
    label: "Capture from Puter",
    domains: ["puter.com"],
    cookies: ["puter_auth_token"],
  },
  "api-airforce": {
    label: "Capture from API Airforce",
    domains: ["api.airforce"],
    cookies: ["airforce_session"],
    mode: "bare",
  },
  "adapta-web": {
    label: "Capture from Adapta",
    domains: ["clerk.agent.adapta.one"],
    cookies: ["__client"],
    mode: "bare",
  },
  "agnes-web": {
    label: "Capture from Agnes",
    domains: ["app.agnes-ai.com"],
    cookies: ["token"],
    mode: "bare",
  },
  "1min": {
    label: "Capture from 1min.ai",
    domains: ["app.1min.ai"],
    authorization: true,
    mode: "bare",
  },
  "inxorastudio-web": {
    label: "Capture from Inxora Studio",
    domains: ["labs.inxorastudio.com"],
    authorization: true,
    mode: "bare",
  },
  "zai-web": {
    label: "Capture from Z.ai",
    domains: ["chat.z.ai"],
    localStorage: ["token"],
    mode: "bare",
  },
  "doubao-web": {
    label: "Capture from Doubao",
    domains: ["doubao.com"],
    fullCookieHeader: true,
  },
  "huggingchat": {
    label: "Capture from HuggingChat",
    domains: ["huggingface.co"],
    fullCookieHeader: true,
  },
  "lmarena": {
    label: "Capture from LMArena",
    domains: ["lmarena.ai"],
    fullCookieHeader: true,
  },
  "t3-web": {
    label: "Capture from T3",
    domains: ["t3.chat"],
    fullCookieHeader: true,
  },
  "v0-vercel-web": {
    label: "Capture from v0",
    domains: ["v0.app"],
    fullCookieHeader: true,
  },
  "venice-web": {
    label: "Capture from Venice",
    domains: ["venice.ai"],
    fullCookieHeader: true,
  },
  "zenmux-free": {
    label: "Capture from ZenMux",
    domains: ["zenmux.ai"],
    fullCookieHeader: true,
  },
  "qwen-web": {
    label: "Capture from Qwen",
    domains: ["chat.qwen.ai"],
    fullCookieHeader: true,
  },
  "qwencloud": {
    label: "Capture from QwenCloud",
    domains: ["qwencloud.com"],
    fullCookieHeader: true,
  },
  "tencent-aistudio-web": {
    label: "Capture from Tencent AI Studio",
    domains: ["aistudio.tencent.ai"],
    fullCookieHeader: true,
  },
};

export function getCookieCaptureConfig(providerId) {
  return COOKIE_CAPTURE[providerId] || null;
}
