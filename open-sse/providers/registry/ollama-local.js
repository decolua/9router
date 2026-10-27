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
  models: [
    { id: "clef", name: "Clef", kind: "systemone" },
    { id: "clef-flash", name: "Clef Flash", kind: "systemone" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "http://localhost:11434/v1/systemone",
    // Saved host (providerSpecificData.baseUrl) is joined with this path.
    path: "/v1/systemone",
  },
};
