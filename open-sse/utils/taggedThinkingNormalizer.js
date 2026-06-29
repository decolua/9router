// continuity: simple tag stripper — removes <think>/<thinking>/<thought>/<reasoning>/<analysis>
// tag markers from content. Inner text stays as visible content. No migration to
// thinking fields. Ceiling: streaming chunk-boundary tag splits may leak; upgrade to
// stateful buffering only if observed in practice.
const TAG_RE = /<\/?(?:think|thinking|thought|reasoning|analysis)>/gi;

// Returns null when no change, or the stripped string when tags were removed.
export function stripTags(text) {
  if (typeof text !== "string") return null;
  const result = text.replace(TAG_RE, "");
  return result === text ? null : result;
}

export function stripTaggedThinking(obj) {
  if (!obj || typeof obj !== "object") return false;
  let changed = false;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (stripTaggedThinking(item)) changed = true;
    }
    return changed;
  }

  if (typeof obj.content === "string") {
    const stripped = stripTags(obj.content);
    if (stripped !== null) { obj.content = stripped; changed = true; }
  }
  if (typeof obj.text === "string") {
    const stripped = stripTags(obj.text);
    if (stripped !== null) { obj.text = stripped; changed = true; }
  }
  if (typeof obj.delta === "string") {
    const stripped = stripTags(obj.delta);
    if (stripped !== null) { obj.delta = stripped; changed = true; }
  }

  for (const key of ["response", "choices", "message", "delta", "output", "content", "candidates", "parts"]) {
    if (obj[key]) {
      if (stripTaggedThinking(obj[key])) changed = true;
    }
  }

  return changed;
}
