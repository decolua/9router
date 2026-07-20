import { DEFAULT_MAX_TOKENS, DEFAULT_MIN_TOKENS } from "open-sse/config/runtimeConfig.js";

const THINKING_OUTPUT_HEADROOM = 1_024;

function checkedAdd(left, right) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left > Number.MAX_SAFE_INTEGER - right) {
    throw new Error("token reservation estimate exceeds safe integer range");
  }
  return left + right;
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function estimateChatUsageReservation(body) {
  const outputCandidates = [
    body?.max_tokens,
    body?.max_completion_tokens,
    body?.max_output_tokens,
    body?.generationConfig?.maxOutputTokens,
  ].map(positiveSafeInteger).filter((value) => value !== null);
  const thinkingBudget = positiveSafeInteger(body?.thinking?.budget_tokens);
  if (thinkingBudget !== null) {
    outputCandidates.push(checkedAdd(thinkingBudget, THINKING_OUTPUT_HEADROOM));
  }
  if (Array.isArray(body?.tools) && body.tools.length > 0) {
    outputCandidates.push(DEFAULT_MIN_TOKENS);
  }

  const outputTokens = outputCandidates.length > 0 ? Math.max(...outputCandidates) : DEFAULT_MAX_TOKENS;
  const inputBytes = Buffer.byteLength(JSON.stringify(body), "utf8");

  // ponytail: Remote image/provider-specific tokenization can exceed local text estimate; actual usage remains authoritative and next admission blocks. Add exact tokenizer/media accounting only when providers expose one common preflight contract.
  return checkedAdd(inputBytes, outputTokens);
}
