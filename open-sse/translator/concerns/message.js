import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: a lone text part becomes a plain string,
// otherwise the array is returned as-is. Cache-aware targets retain marked blocks.
export function collapseTextParts(parts, opts = {}) {
  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT
    && !(opts.preserveCacheControl && parts[0].cache_control) ? parts[0].text : parts;
}
