/**
 * Kimi to OpenAI Response Translator
 * Converts Kimi (Moonshot) streaming chunks to standard OpenAI format,
 * normalizing reasoning/thinking fields to delta.reasoning_content.
 */
import { register } from "../registry.js";
import { FORMATS } from "../formats.js";

export function convertKimiToOpenAI(chunk, state) {
  if (!chunk) return null;

  // Already in standard OpenAI format
  if (chunk.object === "chat.completion.chunk" && chunk.choices) {
    return normalizeKimiChunk(chunk, state);
  }

  // If chunk is raw SSE data string, parse it
  let data = chunk;
  if (typeof chunk === "string") {
    try {
      data = JSON.parse(chunk);
    } catch {
      return null;
    }
  }

  return normalizeKimiChunk(data, state);
}

function normalizeKimiChunk(chunk, state) {
  if (!chunk.choices?.[0]?.delta) return chunk;

  const delta = chunk.choices[0].delta;

  // Normalize Kimi reasoning fields to standard OpenAI reasoning_content
  if (delta.reasoning && !delta.reasoning_content) {
    delta.reasoning_content = delta.reasoning;
    delete delta.reasoning;
  }
  if (delta.thinking && !delta.reasoning_content) {
    delta.reasoning_content = delta.thinking;
    delete delta.thinking;
  }

  // Extract <thinking>...</thinking> or <think>...</think> tags embedded in content
  if (typeof delta.content === "string" && delta.content.includes("<think")) {
    const thinkMatch = delta.content.match(/<think(?:ing)?>([\s\S]*?)<\/(think(?:ing)?)>/);
    if (thinkMatch) {
      const thinkText = thinkMatch[1];
      delta.reasoning_content = (delta.reasoning_content || "") + thinkText;
      delta.content = delta.content.replace(thinkMatch[0], "");
    }
  }

  // Track state for reasoning accumulation
  if (delta.reasoning_content) {
    state.kimiReasoningBuf = (state.kimiReasoningBuf || "") + delta.reasoning_content;
  }

  return chunk;
}

register(FORMATS.KIMI, FORMATS.OPENAI, null, convertKimiToOpenAI);