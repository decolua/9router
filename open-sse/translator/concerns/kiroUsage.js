// The executor's nested Chat usage is cache-inclusive. Legacy flat Kiro usage
// is cache-exclusive; retain that accepted input shape for existing callers.
export function kiroToClaudeUsage(usage = {}) {
  const read = usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  const creation = usage.cache_creation_input_tokens ?? usage.prompt_tokens_details?.cache_creation_tokens;
  const nested = usage.cache_read_input_tokens === undefined && usage.cache_creation_input_tokens === undefined;
  return {
    input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - (nested ? (read || 0) + (creation || 0) : 0)),
    output_tokens: usage.completion_tokens ?? 0,
    ...(typeof read === "number" ? { cache_read_input_tokens: read } : {}),
    ...(typeof creation === "number" ? { cache_creation_input_tokens: creation } : {})
  };
}

export function kiroToResponsesUsage(usage = {}) {
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    input_tokens: input, output_tokens: output, total_tokens: input + output,
    ...(typeof cached === "number" ? { input_tokens_details: { cached_tokens: cached } } : {})
  };
}
