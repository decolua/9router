// Build OpenAI chat.completion.chunk. Caller supplies id/created/model so each
// translator keeps its exact id-generation + created semantics (no Date.now here).
export function buildChunk({ id, created, model, system_fingerprint }, delta, finishReason = null) {
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  // P4.4: pass through `system_fingerprint` when the upstream provides one.
  // Omitted (undefined/null) entirely when not set — keeps behavior identical
  // for existing callers and avoids emitting a meaningless `null`.
  if (system_fingerprint != null) chunk.system_fingerprint = system_fingerprint;
  return chunk;
}
