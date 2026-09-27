// Build OpenAI usage object. Caller computes prompt/completion/total (provider math).
// Optional details added only when > 0 (matches existing claude/gemini/codex behavior).
export function buildUsage({ promptTokens, completionTokens, totalTokens, cachedTokens = 0, cacheCreationTokens = 0, reasoningTokens = 0 }) {
  const usage = { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens };
  if (cachedTokens > 0 || cacheCreationTokens > 0) {
    usage.prompt_tokens_details = {};
    if (cachedTokens > 0) usage.prompt_tokens_details.cached_tokens = cachedTokens;
    if (cacheCreationTokens > 0) usage.prompt_tokens_details.cache_creation_tokens = cacheCreationTokens;
  }
  if (reasoningTokens > 0) {
    usage.completion_tokens_details = { reasoning_tokens: reasoningTokens };
  }
  return usage;
}

const n = (v) => (typeof v === "number" ? v : 0);

// Per-provider raw token field-map + math. Returns buildUsage() args (NOT the usage object).
// Keeps each provider's exact semantics: claude/gemini fold cache+reasoning, others don't.
const USAGE_EXTRACTORS = {
  claude(raw) {
    let input = n(raw.input_tokens), output = n(raw.output_tokens);
    let cacheRead = n(raw.cache_read_input_tokens), cacheCreate = n(raw.cache_creation_input_tokens);
    const iters = Array.isArray(raw.iterations) ? raw.iterations : null;
    const servedByFallback = !!iters?.some((it) => it?.type === "fallback_message");
    if (iters && iters.length > 0 && !servedByFallback) {
      const exec = iters.filter((it) => it?.type === "compaction" || it?.type === "message");
      if (exec.length > 0) {
        input = exec.reduce((a, it) => a + n(it.input_tokens), 0);
        output = exec.reduce((a, it) => a + n(it.output_tokens), 0);
        cacheRead = exec.reduce((a, it) => a + n(it.cache_read_input_tokens), 0);
        cacheCreate = exec.reduce((a, it) => a + n(it.cache_creation_input_tokens), 0);
      }
    }
    const thinking = n(raw.output_tokens_details?.thinking_tokens ?? raw.thinking_tokens);
    const prompt = input + cacheRead + cacheCreate;
    const out = { promptTokens: prompt, completionTokens: output, totalTokens: prompt + output, cachedTokens: cacheRead, cacheCreationTokens: cacheCreate };
    if (thinking > 0) out.reasoningTokens = thinking;
    return out;
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
    const input = n(raw.inputTokens), output = n(raw.outputTokens);
    // ponytail: Amazon Q (Kiro upstream) does not expose cache fields today,
    // but pass through any cache_read/cache_creation/cached_tokens if the
    // event shape grows them later so cost tracking keeps working without
    // a second pass.
    const cached = n(raw.cache_read_input_tokens) || n(raw.cachedTokens) || n(raw.cached_tokens);
    const cacheCreation = n(raw.cache_creation_input_tokens);
    const out = { promptTokens: input, completionTokens: output, totalTokens: input + output };
    if (cached > 0) out.cachedTokens = cached;
    if (cacheCreation > 0) out.cacheCreationTokens = cacheCreation;
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
