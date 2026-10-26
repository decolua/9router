export default {
  id: "muse-web",
  priority: 220,
  // Distinct alias: "muse" belongs to the Muse API provider; this cookie/web
  // variant for muse.ai Hatch is addressed by its own id.
  alias: "muse-web",
  aliases: [
    "mu",
  ],
  uiAlias: "muse-web",
  display: {
    name: "Muse Web",
    icon: "auto_awesome",
    color: "#7C3AED",
    textIcon: "MU",
    website: "https://muse.ai",
  },
  category: "webCookie",
  authType: "cookie",
  // No "llm": muse-chat stays API-reachable but is hidden from LLM lists —
  // this provider is surfaced through the image/video media pages only.
  serviceKinds: ["image", "video"],
  videoConfig: { executorDriven: true },
  authHint: "Paste your muse.ai cookies (hatch_sess=...; hatch_gw=...; hatch_vml=...; hatch_native_auth_device=...) from a logged-in muse.ai session",
  transport: {
    baseUrl: "https://muse.ai",
    format: "openai",
    authType: "cookie",
  },
  models: [
    { id: "muse-chat", name: "Muse Chat" },
    { id: "muse-image", name: "Muse Image", params: ["n", "size"], kind: "image" },
    { id: "muse-video", name: "Muse Video", params: ["size", "seconds", "image"], kind: "video" },
  ],
};
