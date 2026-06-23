/**
 * Finish/stop reason type definitions.
 *
 * Anchors: open-sse/translator/schema/finishReasons.js
 *   - OPENAI_FINISH, CLAUDE_STOP, GEMINI_FINISH
 *
 * Logic concern lives in: open-sse/translator/concerns/finishReason.js
 * (toOpenAIFinish / fromOpenAIFinish mappers — not duplicated here).
 *
 * The JS exports are plain objects (not `as const`), so TS widens their values
 * to `string`. Each re-export below applies a type-only assertion over the
 * runtime anchor to restore literal types. No new runtime values are created.
 */

import {
  OPENAI_FINISH as _OPENAI_FINISH,
  CLAUDE_STOP as _CLAUDE_STOP,
  GEMINI_FINISH as _GEMINI_FINISH,
} from "../translator/schema/finishReasons.js";

/**
 * Re-export of the runtime OPENAI_FINISH object, narrowed to literal types.
 * Source: open-sse/translator/schema/finishReasons.js
 */
export const OPENAI_FINISH = _OPENAI_FINISH as {
  readonly STOP: "stop";
  readonly LENGTH: "length";
  readonly TOOL_CALLS: "tool_calls";
  readonly CONTENT_FILTER: "content_filter";
};

/**
 * Re-export of the runtime CLAUDE_STOP object, narrowed to literal types.
 * Source: open-sse/translator/schema/finishReasons.js
 */
export const CLAUDE_STOP = _CLAUDE_STOP as {
  readonly END_TURN: "end_turn";
  readonly MAX_TOKENS: "max_tokens";
  readonly TOOL_USE: "tool_use";
  readonly STOP_SEQUENCE: "stop_sequence";
  readonly REFUSAL: "refusal";
};

/**
 * Re-export of the runtime GEMINI_FINISH object, narrowed to literal types.
 * Source: open-sse/translator/schema/finishReasons.js
 */
export const GEMINI_FINISH = _GEMINI_FINISH as {
  readonly STOP: "STOP";
  readonly MAX_TOKENS: "MAX_TOKENS";
  readonly SAFETY: "SAFETY";
  readonly RECITATION: "RECITATION";
  readonly BLOCKLIST: "BLOCKLIST";
  readonly PROHIBITED_CONTENT: "PROHIBITED_CONTENT";
};

/**
 * Union of all OpenAI finish_reason strings (hub format, shared across translators).
 * Derived from OPENAI_FINISH (open-sse/translator/schema/finishReasons.js).
 */
export type OpenAIFinishReason =
  (typeof OPENAI_FINISH)[keyof typeof OPENAI_FINISH];

/**
 * Union of all Claude stop_reason strings.
 * Derived from CLAUDE_STOP (open-sse/translator/schema/finishReasons.js).
 */
export type ClaudeStopReason = (typeof CLAUDE_STOP)[keyof typeof CLAUDE_STOP];

/**
 * Union of all Gemini finishReason strings.
 * Derived from GEMINI_FINISH (open-sse/translator/schema/finishReasons.js).
 */
export type GeminiFinishReason =
  (typeof GEMINI_FINISH)[keyof typeof GEMINI_FINISH];

// ---------------------------------------------------------------------------
// Compile-time key-completeness guards
// KeysEqual<A,B> = true when A and B have identical keys, false otherwise.
// AssertTrue<false> errors: `false` does not satisfy `extends true`.
// ---------------------------------------------------------------------------
type KeysEqual<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
type AssertTrue<T extends true> = T;

type _OpenAIFinishKeysMatch = AssertTrue<
  KeysEqual<keyof typeof OPENAI_FINISH, keyof typeof _OPENAI_FINISH>
>;
type _ClaudeStopKeysMatch = AssertTrue<
  KeysEqual<keyof typeof CLAUDE_STOP, keyof typeof _CLAUDE_STOP>
>;
type _GeminiFinishKeysMatch = AssertTrue<
  KeysEqual<keyof typeof GEMINI_FINISH, keyof typeof _GEMINI_FINISH>
>;
