// Self-hosted embeddings — like openaiCompatNode, but the baseUrl is REQUIRED.
//
// openaiCompatNode falls back to https://api.openai.com/v1 when a connection
// carries no providerSpecificData.baseUrl. For a custom NODE that default is
// defensible: the node was created by pointing at some OpenAI-compatible URL, and
// OpenAI is the archetype. For a provider whose entire purpose is "my own
// server", it is actively harmful — a connection saved without a baseUrl sends
// the INPUT TEXT and the API KEY to OpenAI, silently, under a provider named
// "Self-hosted Embedding".
//
// Observed exactly that with a placeholder connection (2026-08-04):
//
//   [selfhosted-embedding/embedding] [401]: Incorrect API key provided: abc.
//   You can find your API key at https://platform.openai.com/account/api-keys.
//
// The key "abc" was typed as a throwaway for a LOCAL server and left the network.
// A self-hosted provider must never have a cloud fallback, so this one refuses
// instead: no baseUrl means a configuration error, reported as such.
import createOpenAIEmbeddingAdapter from "./openai.js";

const baseAdapter = createOpenAIEmbeddingAdapter("openai");

export class MissingBaseUrlError extends Error {
  constructor() {
    super(
      "Self-hosted Embedding needs an endpoint: set this connection's baseUrl to " +
        "the OpenAI base URL of your server, e.g. http://host:8080/v1 (note the /v1 — " +
        "\"/embeddings\" is appended to it). Refusing to fall back to api.openai.com, " +
        "which would send your input and API key to OpenAI."
    );
    this.name = "MissingBaseUrlError";
    this.isConfigError = true;
  }
}

export default {
  ...baseAdapter,
  buildUrl: (_model, creds) => {
    const rawBaseUrl = creds?.providerSpecificData?.baseUrl;
    if (!rawBaseUrl || !String(rawBaseUrl).trim()) throw new MissingBaseUrlError();
    // Accept either the OpenAI base or a full embeddings URL, so a value pasted
    // from a curl example works as well as one typed from the help text.
    const baseUrl = String(rawBaseUrl).trim().replace(/\/$/, "").replace(/\/embeddings$/, "");
    return `${baseUrl}/embeddings`;
  },
};
