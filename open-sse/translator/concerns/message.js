import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: a lone text part becomes a plain string
// (unless it carries cache_control), otherwise the array is returned as-is.
// Matches existing translator behavior while preserving prompt cache markers.
export function collapseTextParts(parts) {
  return parts.length === 1 && parts[0].type === OPENAI_BLOCK.TEXT && !parts[0].cache_control
    ? parts[0].text
    : parts;
}
