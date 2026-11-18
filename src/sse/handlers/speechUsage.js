import { randomUUID } from "node:crypto";
import { saveRequestUsage } from "@/lib/usageDb.js";

// One row per routed core invocation, including account/credential retries.
export async function runSpeechInference(core, options, { apiKey, endpoint }) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const tokens = {};
  const onUsage = (usage) => {
    if (!usage || usage.estimated === true) return;
    for (const key of ["prompt_tokens", "completion_tokens", "input_tokens", "output_tokens", "total_tokens", "cached_tokens", "reasoning_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
      if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) tokens[key] = usage[key];
    }
    for (const key of ["prompt_tokens_details", "completion_tokens_details", "input_tokens_details", "output_tokens_details"]) {
      const details = usage[key];
      if (!details || typeof details !== "object") continue;
      const counts = {};
      for (const field of ["text_tokens", "audio_tokens", "cached_tokens", "reasoning_tokens", "cache_creation_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens"]) {
        if (Number.isSafeInteger(details[field]) && details[field] >= 0) counts[field] = details[field];
      }
      if (Object.keys(counts).length) tokens[key] = counts;
    }
  };
  let success = false;
  try {
    const result = await core({
      ...options,
      onUsage,
    });
    success = result.success;
    onUsage(result.usage);
    return result;
  } finally {
    await saveRequestUsage({
      provider: options.provider,
      model: options.model,
      connectionId: options.credentials?.connectionId || undefined,
      apiKey: apiKey || undefined,
      endpoint,
      requestId,
      timestamp: new Date(startedAt).toISOString(),
      latencyMs: Date.now() - startedAt,
      tokens,
      status: success ? "success" : "error",
    }).catch(() => {});
  }
}
