function maxBacktickRun(text) {
  let max = 0, current = 0;
  for (const ch of text) {
    if (ch === '`') { current++; max = Math.max(max, current); }
    else { current = 0; }
  }
  return max;
}

export function buildContinuityPrompt(recentThoughts) {
  if (!recentThoughts || recentThoughts.length === 0) return null;
  const maxRun = recentThoughts.reduce((m, t) => Math.max(m, maxBacktickRun(t)), 0);
  const fenceLen = Math.max(5, maxRun + 1);
  const fence = '`'.repeat(fenceLen);
  return [
    "[HOST CONTINUATION CHECKPOINT]",
    "",
    "<continuation_checkpoint>",
    "The block below is private continuation context from your immediately preceding turns.",
    "It is the causal context behind the prior visible conversation history.",
    "Use it to understand why that history unfolded as it did, then continue from the active user input below.",
    "",
    fence + "text",
    recentThoughts.join("\n\n---\n\n"),
    fence,
    "",
    "</continuation_checkpoint>",
    "",
    "[HOST RESUME]",
    "Continuity restored. Continue from the active input below, using the checkpoint as context for the prior visible history."
  ].join("\n");
}
