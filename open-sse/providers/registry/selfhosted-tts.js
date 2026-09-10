// Self-hosted, OpenAI-compatible text-to-speech (Kokoro-FastAPI, openedai-speech,
// vLLM-served TTS, ...) — the TTS counterpart of selfhosted-stt.
//
// Every other self-hostable TTS provider here (coqui, tortoise) carries a FIXED
// localhost baseUrl in its registry entry and `authType: "none"`, and the generic
// dispatcher reads `ttsConfig.baseUrl` from that entry rather than from the
// connection. So there was no way to point TTS at a server on another host.
//
// `authType: "apikey"` is what makes the override possible at all: it gives the
// connection a credentials record, which is where providerSpecificData.baseUrl
// lives. Local servers ignore the key; any non-empty value works.
export default {
  id: "selfhosted-tts",
  priority: 50,
  hasFree: true,
  alias: "selfhosted-tts",
  display: {
    name: "Self-hosted TTS",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "TT",
    website: "https://github.com/remsky/Kokoro-FastAPI",
  },
  category: "apikey",
  auth: {
    apiKey: {
      text: "Set Base URL to the server root, e.g. http://host:8880 — /v1/audio/speech is appended. The API key is not checked by local servers; any value works.",
    },
  },
  // Voice is selected as "<model>/<voice>", the same convention the OpenAI TTS
  // adapter uses, so existing clients need no special casing.
  models: [
    { id: "kokoro", name: "Kokoro (self-hosted)", params: ["voice", "response_format", "speed"], kind: "tts" },
  ],
  serviceKinds: ["tts"],
  // Declaring this is what puts a Base URL field on the Add/Edit connection
  // forms; the dashboard stores it as providerSpecificData.baseUrl, which is
  // what `synthesize` reads. Without it the only way to reach a server on
  // another host was to edit the stored connection by hand.
  connectionBaseUrl: {
    label: "Base URL",
    placeholder: "http://tts-host:8880",
    hint: "Server root — /v1/audio/speech is appended. Leave empty to use http://localhost:8880.",
  },
  ttsConfig: {
    // Overridden per connection by providerSpecificData.baseUrl; this default
    // only makes the provider usable on a same-host deployment.
    baseUrl: "http://localhost:8880",
    defaultModel: "kokoro",
    authType: "apikey",
    format: "openai-speech",
  },
};
