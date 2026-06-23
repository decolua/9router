/**
 * Content block type definitions.
 *
 * Anchors: open-sse/translator/schema/blocks.js
 *   - OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM
 *
 * The JS exports are plain objects (not `as const`), so TS widens their values
 * to `string`. Each re-export below applies a type-only assertion over the
 * runtime anchor to restore literal types. No new runtime values are created.
 */

import {
  OPENAI_BLOCK as _OPENAI_BLOCK,
  CLAUDE_BLOCK as _CLAUDE_BLOCK,
  RESPONSES_ITEM as _RESPONSES_ITEM,
} from "../translator/schema/blocks.js";
import type { JsonValue } from "./executor.js";

/**
 * Re-export of the runtime OPENAI_BLOCK object, narrowed to literal types.
 * Source: open-sse/translator/schema/blocks.js
 */
export const OPENAI_BLOCK = _OPENAI_BLOCK as {
  readonly TEXT: "text";
  readonly IMAGE_URL: "image_url";
  readonly IMAGE: "image";
  readonly INPUT_AUDIO: "input_audio";
  readonly AUDIO_URL: "audio_url";
  readonly FILE: "file";
  readonly FUNCTION: "function";
};

/**
 * Re-export of the runtime CLAUDE_BLOCK object, narrowed to literal types.
 * Source: open-sse/translator/schema/blocks.js
 */
export const CLAUDE_BLOCK = _CLAUDE_BLOCK as {
  readonly TEXT: "text";
  readonly IMAGE: "image";
  readonly DOCUMENT: "document";
  readonly TOOL_USE: "tool_use";
  readonly TOOL_RESULT: "tool_result";
  readonly THINKING: "thinking";
  readonly REDACTED_THINKING: "redacted_thinking";
};

/**
 * Re-export of the runtime RESPONSES_ITEM object, narrowed to literal types.
 * Source: open-sse/translator/schema/blocks.js
 */
export const RESPONSES_ITEM = _RESPONSES_ITEM as {
  readonly MESSAGE: "message";
  readonly FUNCTION_CALL: "function_call";
  readonly FUNCTION_CALL_OUTPUT: "function_call_output";
  readonly REASONING: "reasoning";
  readonly OUTPUT_TEXT: "output_text";
  readonly INPUT_TEXT: "input_text";
  readonly INPUT_IMAGE: "input_image";
  readonly SUMMARY_TEXT: "summary_text";
};

// ---------------------------------------------------------------------------
// Discriminator string unions — derived from narrowed runtime maps
// ---------------------------------------------------------------------------

/** Union of all OpenAI content block type strings. */
export type OpenAIBlockType = (typeof OPENAI_BLOCK)[keyof typeof OPENAI_BLOCK];

/** Union of all Claude content block type strings. */
export type ClaudeBlockType = (typeof CLAUDE_BLOCK)[keyof typeof CLAUDE_BLOCK];

/** Union of all OpenAI Responses API item type strings. */
export type ResponsesItemType =
  (typeof RESPONSES_ITEM)[keyof typeof RESPONSES_ITEM];

// ---------------------------------------------------------------------------
// OpenAI content block discriminated union
// Covers every key in OPENAI_BLOCK: text, image_url, image, input_audio,
// audio_url, file, function
// ---------------------------------------------------------------------------

export type OpenAIContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "image"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "audio_url"; audio_url: { url: string } }
  | { type: "file"; file: { file_id?: string; file_data?: string; filename?: string } }
  | { type: "function"; name: string; arguments: string };

// ---------------------------------------------------------------------------
// Claude content block discriminated union
// Covers every key in CLAUDE_BLOCK: text, image, document, tool_use,
// tool_result, thinking, redacted_thinking
//
// `input` (tool_use) is typed as `JsonValue` — tool inputs are arbitrary JSON
// objects per the Claude API spec.
// `content` (tool_result) is `string | JsonValue[]` — simple string results
// or an array of structured JSON content blocks.
// ---------------------------------------------------------------------------

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: string; media_type: string; data: string } }
  | { type: "document"; source: { type: string; media_type?: string; data?: string; url?: string } }
  | { type: "tool_use"; id: string; name: string; input: JsonValue }
  | { type: "tool_result"; tool_use_id: string; content: string | JsonValue[] }
  | { type: "thinking"; thinking: string }
  | { type: "redacted_thinking"; data: string };

// ---------------------------------------------------------------------------
// OpenAI Responses API item discriminated union
// Covers every key in RESPONSES_ITEM: message, function_call,
// function_call_output, reasoning, output_text, input_text, input_image,
// summary_text
// ---------------------------------------------------------------------------

export type ResponsesItem =
  | { type: "message"; role: string; content: string | OpenAIContentBlock[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "reasoning"; summary: Array<{ type: string; text: string }> }
  | { type: "output_text"; text: string }
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "summary_text"; text: string };

// ---------------------------------------------------------------------------
// Compile-time key-completeness guards
// KeysEqual<A,B> = true when A and B have identical keys, false otherwise.
// AssertTrue<false> errors: `false` does not satisfy `extends true`.
// ---------------------------------------------------------------------------
type KeysEqual<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
type AssertTrue<T extends true> = T;

type _OpenAIBlockKeysMatch = AssertTrue<
  KeysEqual<keyof typeof OPENAI_BLOCK, keyof typeof _OPENAI_BLOCK>
>;
type _ClaudeBlockKeysMatch = AssertTrue<
  KeysEqual<keyof typeof CLAUDE_BLOCK, keyof typeof _CLAUDE_BLOCK>
>;
type _ResponsesItemKeysMatch = AssertTrue<
  KeysEqual<keyof typeof RESPONSES_ITEM, keyof typeof _RESPONSES_ITEM>
>;
