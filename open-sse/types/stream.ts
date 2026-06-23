/**
 * SSE stream chunk and writer type definitions.
 *
 * Anchors:
 *   - Chunk shape: open-sse/translator/concerns/chunk.js (buildChunk)
 *   - Writer contract: open-sse/utils/error.js (writeStreamError)
 *   - Format/Role: ./formats
 *   - FinishReason: ./finishReason
 *
 * Discriminator strategy: three named sub-types keyed on a `kind` tag
 * (`"openai"` | `"claude"` | `"gemini"`) that maps to `Format`. This avoids
 * ambiguous structural overlap (OpenAI uses `choices`, Claude uses `type`,
 * Gemini uses `candidates`) and lets callers narrow with a single switch.
 */

import type { Role } from "./formats.js";
import type { OpenAIFinishReason, GeminiFinishReason } from "./finishReason.js";

// ---------------------------------------------------------------------------
// OpenAI chat.completion.chunk
// Shape derived from buildChunk in open-sse/translator/concerns/chunk.js:
//   { id, object, created, model, choices: [{ index, delta, finish_reason }],
//     system_fingerprint? }
// ---------------------------------------------------------------------------

export interface OpenAIDelta {
  content?: string;
  role?: Role;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface OpenAIChunk {
  kind: "openai";
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIDelta;
    finish_reason: OpenAIFinishReason | null;
  }>;
  system_fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Claude streaming event
// Discriminated on the `type` field per the Anthropic streaming protocol.
// ---------------------------------------------------------------------------

export type ClaudeChunk =
  | { kind: "claude"; type: "ping" }
  | { kind: "claude"; type: "message_start"; message: { id: string; type: string; role: Role; content: []; model: string; usage: { input_tokens: number; output_tokens: number } } }
  | { kind: "claude"; type: "content_block_start"; index: number; content_block: { type: string; text?: string } }
  | { kind: "claude"; type: "content_block_delta"; index: number; delta: { type: "text_delta"; text: string } | { type: "input_json_delta"; partial_json: string } }
  | { kind: "claude"; type: "content_block_stop"; index: number }
  | { kind: "claude"; type: "message_delta"; delta: { stop_reason?: string; stop_sequence?: string | null }; usage?: { output_tokens: number } }
  | { kind: "claude"; type: "message_stop" };

// ---------------------------------------------------------------------------
// Gemini candidate chunk
// ---------------------------------------------------------------------------

export interface GeminiChunk {
  kind: "gemini";
  candidates: Array<{
    content: {
      parts: Array<{ text?: string }>;
      role: string;
    };
    finishReason?: GeminiFinishReason;
    index?: number;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Tagged SSE event union
// ---------------------------------------------------------------------------

/** Discriminated union of all SSE chunk shapes, tagged on `kind`. */
export type SSEEvent = OpenAIChunk | ClaudeChunk | GeminiChunk;

// ---------------------------------------------------------------------------
// StreamWriter — minimal contract used by writeStreamError
// (open-sse/utils/error.js: writer.write(encoder.encode(...)))
// The write method takes Uint8Array at runtime; typed as string for the
// higher-level callers that pass encoded strings directly.
// ---------------------------------------------------------------------------

export interface StreamWriter {
  write(chunk: string): void;
  close(): void;
}
