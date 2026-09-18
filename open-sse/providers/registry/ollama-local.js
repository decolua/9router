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
  // The connection's own endpoint, stored as providerSpecificData.baseUrl.
  baseUrlField: {
    label: "Ollama Host URL",
    placeholder: "http://localhost:11434",
  },
  transport: {
    baseUrl: "http://localhost:11434/api/chat",
    format: "ollama",
  },
  serviceKinds: ["llm"],
};
