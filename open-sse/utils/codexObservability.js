import { FALLBACK_SCOPE_ACCOUNT, normalizeFallbackScope } from "../services/fallbackScope.js";

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const REASONING_MODES = new Set(["standard", "pro"]);

function safeModelId(value) {
  if (typeof value !== "string" || !value) return "unknown";
  return value.replace(/[^a-zA-Z0-9._:/-]/g, "?").slice(0, 128) || "unknown";
}

function safeReasoningValue(value, allowed, fallback) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

/**
 * Build a bounded, prompt-free Codex routing trace. Only model routing,
 * reasoning selection, endpoint class, status, and fallback scope are read.
 */
export function formatCodexDecisionLog({
  requestedModel,
  upstreamModel,
  requestBody,
  upstreamBody,
  aliasMode,
  compact = false,
  status,
  fallbackScope = FALLBACK_SCOPE_ACCOUNT,
}) {
  const requestedReasoning = requestBody?.reasoning && typeof requestBody.reasoning === "object"
    ? requestBody.reasoning
    : {};
  const effectiveReasoning = upstreamBody?.reasoning && typeof upstreamBody.reasoning === "object"
    ? upstreamBody.reasoning
    : {};
  const rawRequestedMode = requestedReasoning.mode || aliasMode;
  const rawRequestedEffort = requestedReasoning.effort || requestBody?.reasoning_effort;
  const requestedMode = safeReasoningValue(rawRequestedMode, REASONING_MODES, rawRequestedMode ? "invalid" : "standard");
  const effectiveMode = safeReasoningValue(effectiveReasoning.mode, REASONING_MODES, "standard");
  const requestedEffort = safeReasoningValue(
    rawRequestedEffort,
    REASONING_EFFORTS,
    rawRequestedEffort ? "invalid" : "default",
  );
  const effectiveEffort = safeReasoningValue(effectiveReasoning.effort, REASONING_EFFORTS, "unknown");
  const numericStatus = Number(status);
  const safeStatus = Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599
    ? String(numericStatus)
    : "error";

  return [
    `requested_model=${safeModelId(requestedModel)}`,
    `upstream_model=${safeModelId(upstreamBody?.model || upstreamModel)}`,
    `requested_mode=${requestedMode}`,
    `effective_mode=${effectiveMode}`,
    `requested_effort=${requestedEffort}`,
    `effective_effort=${effectiveEffort}`,
    `endpoint=${compact ? "compact" : "responses"}`,
    `status=${safeStatus}`,
    `fallback_scope=${normalizeFallbackScope(fallbackScope)}`,
  ].join(" · ");
}
