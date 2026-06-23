// OmniRoute theoldllm provider — free no-auth web provider. Uses the
// TheOldLlmExecutor (registered in open-sse/executors/index.js) which generates
// the X-Request-Token server-side and proxies theoldllm.vercel.app.
const theoldllm = {
  id: "theoldllm",
  priority: 70,
  alias: "theoldllm",
  display: {
    name: "TheOldLLM",
    icon: "history_edu",
    color: "#8B5CF6",
    textIcon: "TO",
    website: "https://theoldllm.vercel.app",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://theoldllm.vercel.app/api/chatgpt",
    noAuth: true,
  },
  passthroughModels: true,
  models: [
    { id: "theoldllm-model", name: "TheOldLLM Model (Auto)" },
    { id: "gpt-4o", name: "GPT-4o (via TheOldLLM)" },
    { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet (via TheOldLLM)" },
  ],
};
export default theoldllm;
