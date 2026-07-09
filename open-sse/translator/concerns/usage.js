// Build OpenAI usage object. Caller computes prompt/completion/total (provider math).
// Optional details added only when > 0 (matches existing claude/gemini/codex behavior).
export function buildUsage({
  promptTokens,
  completionTokens,
  totalTokens,
  cachedTokens = 0,
  cacheCreationTokens = 0,
  reasoningTokens = 0,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0
}) {
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens };
  if (cachedTokens > 0 || cacheCreationTokens > 0) {
    usage.prompt_tokens_details = {};
    if (cachedTokens > 0) usage.prompt_tokens_details.cached_tokens = cachedTokens;
    if (cacheCreationTokens > 0) usage.prompt_tokens_details.cache_creation_tokens = cacheCreationTokens;
  }
  if (cacheReadInputTokens > 0) usage.cache_read_input_tokens = cacheReadInputTokens;
  if (cacheCreationInputTokens > 0) usage.cache_creation_input_tokens = cacheCreationInputTokens;
  if (reasoningTokens > 0) {
    usage.completion_tokens_details = { reasoning_tokens: reasoningTokens };
  }
  return usage;
}

const n = (v) => (typeof v === "number" ? v : 0);
const firstNumber = (...values) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
};

const kiroUsagePayload = (raw) => {
  if (!raw || typeof raw !== "object") return raw;
  if (raw.tokenUsage) return raw.tokenUsage;
  if (raw.metadataEvent?.tokenUsage) return raw.metadataEvent.tokenUsage;
  if (raw.metricsEvent?.tokenUsage) return raw.metricsEvent.tokenUsage;
  if (raw.usageEvent) return raw.usageEvent;
  if (raw.metricsEvent && typeof raw.metricsEvent === "object") return raw.metricsEvent;
  return raw;
};

// Per-provider raw token field-map + math. Returns buildUsage() args (NOT the usage object).
// Keeps each provider's exact semantics: claude/gemini fold cache+reasoning, others don't.
const USAGE_EXTRACTORS = {
  claude(raw) {
    const input = n(raw.input_tokens), output = n(raw.output_tokens);
    const cacheRead = n(raw.cache_read_input_tokens), cacheCreate = n(raw.cache_creation_input_tokens);
    const prompt = input + cacheRead + cacheCreate;
    return { promptTokens: prompt, completionTokens: output, totalTokens: prompt + output, cachedTokens: cacheRead, cacheCreationTokens: cacheCreate };
  },
  gemini(raw) {
    const cached = n(raw.cachedContentTokenCount);
    const prompt = n(raw.promptTokenCount);
    const thoughts = n(raw.thoughtsTokenCount);
    const total = n(raw.totalTokenCount);
    let candidates = n(raw.candidatesTokenCount);
    // Fallback: derive candidates from total when upstream omits it
    if (candidates === 0 && total > 0) {
      candidates = total - prompt - thoughts;
      if (candidates < 0) candidates = 0;
    }
    return { promptTokens: prompt, completionTokens: candidates + thoughts, totalTokens: total, cachedTokens: cached, reasoningTokens: thoughts };
  },
  kiro(raw) {
    const usage = kiroUsagePayload(raw) || {};
    const input = firstNumber(
      usage.uncachedInputTokens,
      usage.inputTokens,
      usage.input_tokens,
      usage.prompt_tokens
    );
    const output = firstNumber(
      usage.outputTokens,
      usage.output_tokens,
      usage.completion_tokens
    );
    const cached = firstNumber(
      usage.cacheReadInputTokens,
      usage.cache_read_input_tokens,
      usage.cachedTokens,
      usage.cached_tokens
    );
    const cacheCreation = firstNumber(
      usage.cacheWriteInputTokens,
      usage.cacheCreationInputTokens,
      usage.cache_creation_input_tokens
    );
    const out = {
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output
    };
    if (cached > 0) out.cachedTokens = cached;
    if (cacheCreation > 0) out.cacheCreationTokens = cacheCreation;
    // Kiro native input is cache-exclusive. Carry Claude-style cache fields so
    // canonical storage can fold them into prompt_tokens exactly once.
    if (cached > 0) out.cacheReadInputTokens = cached;
    if (cacheCreation > 0) out.cacheCreationInputTokens = cacheCreation;
    return out;
  },
  ollama(raw) {
    const input = n(raw.prompt_eval_count), output = n(raw.eval_count);
    return { promptTokens: input, completionTokens: output, totalTokens: input + output };
  },
  commandcode(raw) {
    const input = n(raw.inputTokens), output = n(raw.outputTokens);
    const total = typeof raw.totalTokens === "number" ? raw.totalTokens : input + output;
    return { promptTokens: input, completionTokens: output, totalTokens: total };
  },
};

// Convert provider-native usage object → OpenAI usage. Returns null if no extractor/raw.
export function toOpenAIUsage(raw, kind) {
  const extract = USAGE_EXTRACTORS[kind];
  if (!extract || !raw || typeof raw !== "object") return null;
  return buildUsage(extract(raw));
}
