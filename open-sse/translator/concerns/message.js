import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array. A text-only array (one OR more text
// blocks) is joined into a single plain string; any array containing non-text
// blocks (image_url, tool_result, …) is returned as-is so multimodal content
// keeps its structure. This fixes providers that reject repeated
// [{type:text},{type:text}] arrays and avoids losing content when a single
// Claude message carries several consecutive text blocks.
export function collapseTextParts(parts) {
  if (parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT) {
    return parts[0].text;
  }
  if (parts.every((p) => p.type === OPENAI_BLOCK.TEXT)) {
    return parts.map((p) => p.text).join("\n");
  }
  return parts;
}
