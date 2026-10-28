export default {
  id: "chatgpt-web",
  priority: 220,
  alias: "chatgpt-web",
  aliases: [
    "cg",
  ],
  uiAlias: "chatgpt-web",
  display: {
    name: "ChatGPT Web",
    icon: "auto_awesome",
    color: "#10A37F",
    textIcon: "CG",
    website: "https://chatgpt.com",
  },
  category: "webCookie",
  authType: "cookie",
  // LLM + tools work over plain HTTP, but the provider is parked on image
  // until the chat path has more mileage. Flip "llm" back in when it does.
  serviceKinds: ["image"],
  authHint: "Paste your chatgpt.com cookie header containing __Secure-next-auth.session-token (or a full Playwright storage-state JSON)",
  transport: {
    baseUrl: "https://chatgpt.com",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "gpt-5-6", name: "GPT-5.6 Sol — Instant" },
    { id: "gpt-5-6-thinking", name: "GPT-5.6 Sol — Thinking", supportsReasoning: true },
    { id: "gpt-5-6-pro", name: "GPT-5.6 Sol — Pro", supportsReasoning: true },
    { id: "gpt-5.6-luna-free", name: "GPT-5.6 Luna — Free" },
    { id: "gpt-5.6-luna-free-thinking", name: "GPT-5.6 Luna — Free Thinking", supportsReasoning: true },
    { id: "gpt-5-5-instant", name: "GPT-5.5 — Instant" },
    { id: "gpt-5-5-thinking", name: "GPT-5.5 — Thinking", supportsReasoning: true },
    { id: "gpt-5-5-pro", name: "GPT-5.5 — Pro", supportsReasoning: true },
    { id: "gpt-image-2", name: "GPT Image 2 (web)", params: ["n", "size"], kind: "image" },
  ],
};
