export function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

export function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

export function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  // Canonical storage keeps prompt cache-inclusive. Legacy Claude rows may have
  // stored prompt cache-exclusive; fall back to cache when it's larger so old
  // rows don't under-report input.
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

export function getOutputTokens(tokens) {
  // Translators store usage in either OpenAI field names
  // (completion_tokens) or Claude field names (output_tokens) — issue #3890.
  return tokens?.completion_tokens || tokens?.output_tokens || 0;
}

const COMPACT_TOKEN_UNITS = [
  { value: 1e12, suffix: "T" },
  { value: 1e9, suffix: "B" },
  { value: 1e6, suffix: "M" },
  { value: 1e3, suffix: "K" },
];

export function fmtCompactTokens(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num === 0) return "0";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  for (let i = 0; i < COMPACT_TOKEN_UNITS.length; i++) {
    const { value, suffix } = COMPACT_TOKEN_UNITS[i];
    if (abs >= value) {
      const scaled = abs / value;
      if (Number(scaled.toFixed(1)) >= 1000 && i > 0) {
        const upper = COMPACT_TOKEN_UNITS[i - 1];
        return `${sign}${(abs / upper.value).toFixed(1)}${upper.suffix}`;
      }
      return `${sign}${scaled.toFixed(1)}${suffix}`;
    }
  }

  if (Math.round(abs) >= 1000) {
    return `${sign}1.0K`;
  }
  return String(num);
}
