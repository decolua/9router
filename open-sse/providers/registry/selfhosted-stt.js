// Self-hosted, OpenAI-compatible speech-to-text (whisper.cpp, faster-whisper,
// Speaches, vLLM-served Whisper, ...).
//
// Every other STT provider here is a named cloud service with a fixed endpoint.
// This one exists so a locally-served /v1/audio/transcriptions can be used at
// all: set the connection's providerSpecificData.baseUrl to the full URL of the
// endpoint, exactly as the custom embedding providers already work.
//
// sttCore dispatches on `format`; anything that is not one of the five named
// cloud shapes falls through to transcribeOpenAICompatible, which POSTs the
// standard multipart body (file, model, and optional language / prompt /
// response_format / temperature). That is precisely what whisper.cpp's OpenAI
// endpoint accepts.
//
// authType is "apikey" rather than "none" so the connection carries a
// credentials record — which is where providerSpecificData.baseUrl lives. Local
// servers ignore the key itself; any non-empty value works.
export default {
  id: "selfhosted-stt",
  priority: 50,
  hasFree: true,
  alias: "selfhosted-stt",
  display: {
    name: "Self-hosted STT",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "ST",
    website: "https://github.com/ggml-org/whisper.cpp",
  },
  category: "apikey",
  auth: {
    apiKey: {
      text: "Set providerSpecificData.baseUrl to the full transcriptions URL, e.g. http://host:8080/v1/audio/transcriptions. The API key is not checked by local servers; any value works.",
    },
  },
  models: [
    { id: "whisper-1", name: "Whisper (self-hosted)", params: ["language", "response_format", "temperature", "prompt"], kind: "stt" },
  ],
  serviceKinds: ["stt"],
  sttConfig: {
    // Overridden per connection by providerSpecificData.baseUrl; this default
    // only makes the provider usable out of the box on a same-host deployment.
    baseUrl: "http://localhost:8080/v1/audio/transcriptions",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
};
