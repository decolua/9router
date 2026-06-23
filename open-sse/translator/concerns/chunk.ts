// Build OpenAI chat.completion.chunk. Caller supplies id/created/model so each
// translator keeps its exact id-generation + created semantics (no Date.now here).
import type { OpenAIFinishReason } from "../../types/finishReason.js";
import type { OpenAIDelta } from "../../types/stream.js";

export interface ChunkMeta {
  id: string;
  created: number;
  model: string;
  system_fingerprint?: string | null;
}

export interface OpenAIChunkResult {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIDelta;
    finish_reason: OpenAIFinishReason | null;
  }>;
  system_fingerprint?: string;
}

export function buildChunk(
  { id, created, model, system_fingerprint }: ChunkMeta,
  delta: OpenAIDelta,
  finishReason: OpenAIFinishReason | null = null,
): OpenAIChunkResult {
  const chunk: OpenAIChunkResult = {
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
