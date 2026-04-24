/**
 * Cursor to OpenAI Response Translator
 * CursorExecutor already emits OpenAI format - this is a passthrough
 */
import { register } from "../index";
import { FORMATS } from "../formats";

/**
 * Convert Cursor response to OpenAI format
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function convertCursorToOpenAI(chunk: any, state: any) {
  if (!chunk) return null;

  // If chunk is already in OpenAI format (from executor transform), return as-is
  if (chunk.object === "chat.completion.chunk" && chunk.choices) {
    return chunk;
  }

  // If chunk is a completion object (non-streaming), return as-is
  if (chunk.object === "chat.completion" && chunk.choices) {
    return chunk;
  }

  // Fallback: return chunk as-is (should not reach here)
  return chunk;
}

register(FORMATS.CURSOR, FORMATS.OPENAI, null, convertCursorToOpenAI);
register(FORMATS.CURSOR_CU, FORMATS.OPENAI, null, convertCursorToOpenAI);
