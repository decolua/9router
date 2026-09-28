import { CLAUDE_API_HEADERS } from "../shared.js";

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
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  // Host is resolved at request time by OllamaLocalExecutor.buildUrl via resolveOllamaLocalHost.
  transports: [
    {
      format: "claude",
      baseUrl: "http://localhost:11434/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      // COMP-04: Bearer to match cloud (ollama auth domain). Local ollama doesn't validate
      // keys, so this is a no-op when no key is set — but stays consistent with cloud.
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  serviceKinds: ["llm"],
};
