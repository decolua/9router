export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {},
    usage: {
      url: "https://opencode.ai/zen/go/v1/usage",
    },
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. Guarded per-model by `supportedFormats` (see chatCore) because
  // opencode-go models differ in endpoint support.
  transports: [
    { format: "openai", baseUrl: "https://opencode.ai/zen/go/v1/chat/completions", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: "https://opencode.ai/zen/go/v1/messages", auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: "https://opencode.ai/zen/go/v1/responses", auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  models: [
    // Official OpenCode Go endpoint families (opencode.ai/docs/go/#endpoints):
    //   chat/completions — GLM, Kimi, DeepSeek, MiMo, Hy, LongCat, Omen
    //   messages         — MiniMax, Qwen
    //   responses        — Grok, GPT-5.6 Luna, Muse Spark
    // Each model lives on exactly one endpoint; the gateway cross-translates for
    // clients of other formats. A model must therefore declare only the client
    // format that maps to its native endpoint — declaring "claude" for a
    // chat/completions-only model (e.g. DeepSeek) routed claude-format clients
    // straight to /messages, which 404s upstream. Chat-only models here work from
    // a claude-format client because chatCore falls back to /chat/completions and
    // the translator converts (this is what makes glm-5.3-flash work today).
    //
    // chat/completions family (["openai"] only):
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportedFormats: ["openai"] },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision Exp", supportedFormats: ["openai"] },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportedFormats: ["openai"] },
    { id: "glm-5", name: "GLM 5", supportedFormats: ["openai"] },
    { id: "glm-5.1", name: "GLM 5.1", supportedFormats: ["openai"] },
    { id: "glm-5.2", name: "GLM 5.2", supportedFormats: ["openai"] },
    { id: "glm-5.3", name: "GLM 5.3", supportedFormats: ["openai"] },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash (Vision)", supportedFormats: ["openai"] },
    { id: "hy3", name: "Hy3", supportedFormats: ["openai"] },
    { id: "hy3-preview", name: "Hy3 Preview", supportedFormats: ["openai"] },
    { id: "hy4-preview", name: "Hy4 Preview", supportedFormats: ["openai"] },
    { id: "kimi-k2.5", name: "Kimi K2.5", supportedFormats: ["openai"] },
    { id: "kimi-k2.6", name: "Kimi K2.6", supportedFormats: ["openai"] },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", supportedFormats: ["openai"] },
    { id: "kimi-k3", name: "Kimi K3", supportedFormats: ["openai"] },
    { id: "longcat-2.0", name: "LongCat 2.0", supportedFormats: ["openai"] },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni", supportedFormats: ["openai"] },
    { id: "mimo-v2-pro", name: "MiMo V2 Pro", supportedFormats: ["openai"] },
    { id: "mimo-v2.5", name: "MiMo V2.5", supportedFormats: ["openai"] },
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro", supportedFormats: ["openai"] },
    { id: "omen-alpha", name: "Omen Alpha", supportedFormats: ["openai"] },
    // /messages family — MiniMax, Qwen (native Anthropic endpoint + OpenAI chat).
    { id: "minimax-m2.5", name: "MiniMax M2.5", supportedFormats: ["openai", "claude"] },
    { id: "minimax-m2.7", name: "MiniMax M2.7", supportedFormats: ["openai", "claude"] },
    { id: "minimax-m3", name: "MiniMax M3", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.8-max", name: "Qwen 3.8 Max", supportedFormats: ["openai", "claude"] },
    // /responses family — Grok, GPT-5.6 Luna, Muse Spark. targetFormat routes
    // chat/claude clients through translation to /responses; the executor then
    // builds the /responses URL (see opencode-go.js isResponsesModel). Responses-only
    // models force chatCore past the sourceFormat-matched transports (see chatCore guard).
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "grok-4.5", name: "Grok 4.5", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "grok-4.6", name: "Grok 4.6", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
