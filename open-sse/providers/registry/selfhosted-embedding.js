// Self-hosted, OpenAI-compatible embeddings (llama.cpp / llama-server, vLLM,
// Infinity, text-embeddings-inference, ...) — the embeddings counterpart of
// selfhosted-stt and selfhosted-tts.
//
// Routing a self-hosted embeddings server already WORKS today, via a custom
// provider node: getEmbeddingAdapter() matches `openai-compatible-*` and
// `custom-embedding-*` and returns openaiCompatNode, whose buildUrl reads
// creds.providerSpecificData.baseUrl. What is missing is a first-class provider,
// and the gap is visible rather than functional:
//
//   /v1/embeddings on such a node          -> 200, correct vectors
//   the Embedding page in the dashboard    -> the node is not listed at all
//
// The page renders getProvidersByKind("embedding") plus provider nodes filtered
// to `type === "custom-embedding"`. A node created as `openai-compatible` — the
// natural choice when ONE endpoint serves chat and embeddings behind the same
// front door — satisfies neither, so a working self-hosted embeddings endpoint is
// invisible on the page whose job is to show embeddings providers. Diagnosed on a
// deployment serving Qwen3-Embedding-8B at 4096 dimensions through exactly that
// shape (2026-08-04).
//
// Declaring it as a provider with serviceKinds: ["embedding"] puts it on the page
// beside Voyage, Jina and the rest, and keeps the per-connection baseUrl that
// makes self-hosting possible at all.
//
// authType is "apikey" rather than "none" for the same reason as the STT and TTS
// entries: it is what gives the connection a credentials record, and
// providerSpecificData.baseUrl lives there. Local servers ignore the key itself;
// any non-empty value works.
export default {
  id: "selfhosted-embedding",
  priority: 50,
  hasFree: true,
  alias: "selfhosted-embedding",
  display: {
    name: "Self-hosted Embedding",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "SE",
    website: "https://github.com/ggml-org/llama.cpp",
  },
  category: "apikey",
  auth: {
    apiKey: {
      // Note the /v1: the adapter appends "/embeddings" to whatever it is given,
      // so a bare http://host:8080 resolves to http://host:8080/embeddings and
      // misses the OpenAI route entirely. Give it the OpenAI base, the same value
      // an OpenAI client would use. A trailing /embeddings is tolerated.
      text: "Set providerSpecificData.baseUrl to the OpenAI base URL, e.g. http://host:8080/v1 — /embeddings is appended. The API key is not checked by local servers; any value works.",
    },
  },
  // A self-hosted server serves whatever model it was started with, so the id
  // here is a placeholder for the UI: the request passes `model` straight
  // through, and llama-server ignores an unknown value rather than rejecting it.
  // Dimensions are deliberately NOT declared — they are a property of the loaded
  // weights, and asserting a number here would be a guess that silently
  // contradicts the server.
  models: [
    { id: "embedding", name: "Self-hosted embedding model", kind: "embedding" },
  ],
  serviceKinds: ["embedding"],
  embeddingConfig: {
    // Declared for shape-consistency with the other embedding providers, and
    // read by the UI — but NOT by the request path. openaiCompatNode resolves the
    // URL purely from creds.providerSpecificData.baseUrl (falling back to
    // api.openai.com), so unlike a fixed cloud provider this baseUrl never
    // reaches the wire. Stated plainly because a reader would otherwise
    // reasonably assume it is the default endpoint.
    baseUrl: "http://localhost:8080/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
};
