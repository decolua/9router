export default {
  id: "ollama-local",
  priority: 50,
  hasFree: true,
  alias: "ollama-local",
  display: {
    name: "Ollama Local",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "http://localhost:11434/api/chat",
    format: "ollama",
  },
  // Ollama cold-start (model loading) can take 120s+ for 7B models.
  // Default FETCH_CONNECT_TIMEOUT_MS (60s) is too short.
  timeoutMs: 180000,
  serviceKinds: ["llm"],
};
