function positiveInteger(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.floor(number);
}

export function normalizeModelTokenLimits(input = {}) {
  const maxInputTokens = positiveInteger(
    input.max_input_tokens
      ?? input.maxInputTokens
      ?? input.context_length
      ?? input.contextLength
      ?? input.contextWindow
  );
  const maxOutputTokens = positiveInteger(input.max_output_tokens ?? input.maxOutputTokens);

  const limits = {};
  if (maxInputTokens !== undefined) {
    limits.max_input_tokens = maxInputTokens;
    limits.context_length = maxInputTokens;
  }
  if (maxOutputTokens !== undefined) {
    limits.max_output_tokens = maxOutputTokens;
  }
  return limits;
}

export function withModelTokenLimits(entry, model = {}) {
  if (!entry || typeof entry !== "object") return entry;
  const limits = normalizeModelTokenLimits(model);
  return Object.keys(limits).length > 0 ? { ...entry, ...limits } : entry;
}
