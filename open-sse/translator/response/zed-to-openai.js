/**
 * Zed → OpenAI response translator
 * ZedExecutor already emits OpenAI chat.completion(.chunk) objects — passthrough.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

export function zedToOpenAIResponse(chunk) {
  if (!chunk) return null;
  if (chunk.object === "chat.completion.chunk" && chunk.choices) return chunk;
  if (chunk.object === "chat.completion" && chunk.choices) return chunk;
  return chunk;
}

register(FORMATS.ZED, FORMATS.OPENAI, null, zedToOpenAIResponse);
