// Absent `stream` means false (OpenAI/Anthropic semantics). Gemini-style source
// formats stream by endpoint, so the caller passes that in as `clientRequestedStreaming`.
export function resolveStream({ body, clientRequestedStreaming, providerRequiresStreaming }) {
  if (providerRequiresStreaming) return true;
  if (body.stream == null) return clientRequestedStreaming;
  return body.stream !== false;
}
