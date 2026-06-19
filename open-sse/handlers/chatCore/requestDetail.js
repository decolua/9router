import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { FORMATS } from "../../translator/formats.js";
import { toOpenAIUsage } from "../../translator/concerns/usage.js";
import { COLORS } from "../../utils/stream.js";
import { estimateInputTokens } from "../../utils/usageTracking.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

function completeEstimatedPromptTokens(usage, requestBody) {
  if (!usage || typeof usage !== "object") return usage;

  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  if (promptTokens !== 0 || completionTokens === 0 || !requestBody) return usage;

  const estimatedPromptTokens = estimateInputTokens(requestBody);
  if (estimatedPromptTokens <= 0) return usage;

  return {
    ...usage,
    prompt_tokens: estimatedPromptTokens,
    total_tokens: estimatedPromptTokens + completionTokens,
    estimated: true
  };
}

function hasUsableTokenData(usage) {
  if (!usage || typeof usage !== "object") return false;

  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? 0;

  return promptTokens > 0 || completionTokens > 0 || totalTokens > 0;
}

function extractOpenAIResponsesUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
    return {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      cached_tokens: usage.input_tokens_details?.cached_tokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
      prompt_tokens_details: usage.input_tokens_details?.cached_tokens
        ? { cached_tokens: usage.input_tokens_details.cached_tokens }
        : undefined,
      completion_tokens_details: usage.output_tokens_details
    };
  }

  if (usage.prompt_tokens !== undefined) {
    return {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens,
      cached_tokens: usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens,
      prompt_tokens_details: usage.prompt_tokens_details,
      completion_tokens_details: usage.completion_tokens_details
    };
  }

  return null;
}

function extractGeminiUsage(usageMetadata) {
  if (!usageMetadata || typeof usageMetadata !== "object") return null;

  return {
    prompt_tokens: usageMetadata.promptTokenCount || 0,
    completion_tokens: usageMetadata.candidatesTokenCount || 0,
    total_tokens: usageMetadata.totalTokenCount,
    cached_tokens: usageMetadata.cachedContentTokenCount,
    reasoning_tokens: usageMetadata.thoughtsTokenCount
  };
}

function providerUsageKind(targetFormat, provider) {
  const providerName = String(provider || "").toLowerCase();

  if (targetFormat === FORMATS.OLLAMA || providerName === "ollama" || providerName === "ollama-local") return "ollama";
  if (targetFormat === FORMATS.KIRO || providerName === "kiro") return "kiro";
  if (targetFormat === FORMATS.COMMANDCODE || providerName === "commandcode") return "commandcode";
  if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.VERTEX) return "gemini";
  if (targetFormat === FORMATS.CLAUDE || providerName === "claude") return "claude";

  return null;
}

export function extractUsageFromResponse(responseBody, { targetFormat, provider, requestBody } = {}) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude format
  if (responseBody.usage?.input_tokens !== undefined) {
    return completeEstimatedPromptTokens({
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      total_tokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0),
      cache_read_input_tokens: responseBody.usage.cache_read_input_tokens,
      cache_creation_input_tokens: responseBody.usage.cache_creation_input_tokens
    }, requestBody);
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    return completeEstimatedPromptTokens({
      prompt_tokens: responseBody.usage.prompt_tokens || 0,
      completion_tokens: responseBody.usage.completion_tokens || 0,
      total_tokens: responseBody.usage.total_tokens,
      cached_tokens: responseBody.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: responseBody.usage.completion_tokens_details?.reasoning_tokens,
      prompt_tokens_details: responseBody.usage.prompt_tokens_details,
      completion_tokens_details: responseBody.usage.completion_tokens_details
    }, requestBody);
  }

  // OpenAI Responses API format nested under response
  const responseUsage = extractOpenAIResponsesUsage(responseBody.response?.usage);
  if (responseUsage) {
    return completeEstimatedPromptTokens(responseUsage, requestBody);
  }

  // Gemini format
  const geminiUsage = extractGeminiUsage(responseBody.usageMetadata || responseBody.response?.usageMetadata);
  if (geminiUsage) {
    return completeEstimatedPromptTokens(geminiUsage, requestBody);
  }

  const usageKind = providerUsageKind(targetFormat, provider);
  if (usageKind) {
    const mappedUsage = toOpenAIUsage(responseBody, usageKind);
    const completedUsage = completeEstimatedPromptTokens(mappedUsage, requestBody);
    return hasUsableTokenData(completedUsage) ? completedUsage : null;
  }

  return null;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    status: base.status || "success",
    ...overrides
  };
}

export function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE" }) {
  if (!tokens || typeof tokens !== "object") return;

  const inTokens = tokens.input_tokens ?? tokens.prompt_tokens ?? 0;
  const outTokens = tokens.output_tokens ?? tokens.completion_tokens ?? 0;

  if (inTokens === 0 && outTokens === 0) return;

  const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
  console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);

  // Normalize to OpenAI token shape for storage
  const normalized = {
    prompt_tokens: tokens.prompt_tokens ?? tokens.input_tokens ?? 0,
    completion_tokens: tokens.completion_tokens ?? tokens.output_tokens ?? 0,
    total_tokens: tokens.total_tokens,
    cache_read_input_tokens: tokens.cache_read_input_tokens,
    cache_creation_input_tokens: tokens.cache_creation_input_tokens,
    cached_tokens: tokens.cached_tokens ?? tokens.prompt_tokens_details?.cached_tokens,
    reasoning_tokens: tokens.reasoning_tokens ?? tokens.completion_tokens_details?.reasoning_tokens,
    prompt_tokens_details: tokens.prompt_tokens_details,
    completion_tokens_details: tokens.completion_tokens_details,
    estimated: tokens.estimated
  };

  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null
  }).catch(() => {});
}
