// Video provider adapters.
//
// Default (no adapter) = xAI shape: raw body forwarded to {baseUrl}/{action},
// polled at {baseUrl}/{id}, upstream JSON passed through verbatim.
// A provider only needs an adapter when its wire format differs from that.
import openrouter from "./openrouter.js";
import vertex from "./vertex.js";

const ADAPTERS = { openrouter, vertex };

export function getVideoAdapter(provider) {
  return ADAPTERS[provider] || null;
}

// Some adapters mint self-identifying job ids (Vertex encodes the operation
// path into the id). A poll carries no model, so this lets the provider be
// recovered from the id when the client did not pin a connection.
export function findProviderByJobId(jobId) {
  if (!jobId) return null;
  for (const [provider, adapter] of Object.entries(ADAPTERS)) {
    if (adapter.ownsJobId?.(jobId)) return provider;
  }
  return null;
}
