/**
 * Format and Role type definitions.
 *
 * Anchors:
 *   - FORMATS: open-sse/translator/formats.js
 *   - ROLE: open-sse/translator/schema/roles.js
 *     (NOTE: ROLE is NOT exported from formats.js; it lives in schema/roles.js.
 *      Assignment listed formats.js as the anchor — sourced from schema/roles.js instead.)
 *
 * The JS exports are plain objects (not `as const`), so TS widens their values
 * to `string`. Each re-export below applies a type-only assertion over the
 * runtime anchor to restore literal types. No new runtime values are created.
 */

import { FORMATS as _FORMATS } from "../translator/formats.js";
import { ROLE as _ROLE } from "../translator/schema/roles.js";

/**
 * Re-export of the runtime FORMATS object (open-sse/translator/formats.js),
 * narrowed via type assertion so consumers get literal value types.
 */
export const FORMATS = _FORMATS as {
  readonly OPENAI: "openai";
  readonly OPENAI_RESPONSES: "openai-responses";
  readonly OPENAI_RESPONSE: "openai-response";
  readonly CLAUDE: "claude";
  readonly GEMINI: "gemini";
  readonly GEMINI_CLI: "gemini-cli";
  readonly VERTEX: "vertex";
  readonly CODEX: "codex";
  readonly ANTIGRAVITY: "antigravity";
  readonly KIRO: "kiro";
  readonly CURSOR: "cursor";
  readonly OLLAMA: "ollama";
  readonly COMMANDCODE: "commandcode";
};

/**
 * Re-export of the runtime ROLE object (open-sse/translator/schema/roles.js),
 * narrowed via type assertion so consumers get literal value types.
 */
export const ROLE = _ROLE as {
  readonly USER: "user";
  readonly ASSISTANT: "assistant";
  readonly TOOL: "tool";
  readonly SYSTEM: "system";
  readonly DEVELOPER: "developer";
};

/**
 * Union of all format identifier strings.
 * Derived from FORMATS (open-sse/translator/formats.js) — single source of truth.
 */
export type Format = (typeof FORMATS)[keyof typeof FORMATS];

/**
 * Union of all role identifier strings.
 * Derived from ROLE (open-sse/translator/schema/roles.js) — single source of truth.
 */
export type Role = (typeof ROLE)[keyof typeof ROLE];

// ---------------------------------------------------------------------------
// Compile-time key-completeness guards
// KeysEqual<A,B> = true when A and B have identical keys, false otherwise.
// AssertTrue<false> errors: `false` does not satisfy `extends true`.
// ---------------------------------------------------------------------------
type KeysEqual<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never]
  ? true
  : false;
type AssertTrue<T extends true> = T;

type _FormatsKeysMatch = AssertTrue<
  KeysEqual<keyof typeof FORMATS, keyof typeof _FORMATS>
>;
type _RoleKeysMatch = AssertTrue<
  KeysEqual<keyof typeof ROLE, keyof typeof _ROLE>
>;
