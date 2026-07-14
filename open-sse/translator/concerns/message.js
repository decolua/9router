import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: when every part is text they are
// joined into a single string (preserving multi-part text like ["hi","there"]
// -> "hi\nthere"); otherwise the array is returned as-is (multimodal). Matches
// existing translator behavior for the single-text-part case and extends it to
// multi-part text arrays.
export function collapseTextParts(parts) {
  const onlyText = parts.every(p => p.type === OPENAI_BLOCK.TEXT);
  return onlyText ? parts.map(p => p.text).join("\n") : parts;
}
