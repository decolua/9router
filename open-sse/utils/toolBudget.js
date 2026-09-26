import { disclosureTools, extractPinnedNames } from "./toolDisclosure.js";

const CHARS_PER_TOKEN = 4;
const DEFAULT_INPUT_BUDGET_RATIO = 0.85;
const DEFAULT_OUTPUT_RESERVE = 32768;

function jsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value) || "").length;
  } catch {
    return 0;
  }
}

function estimateTokens(value) {
  return Math.ceil(jsonBytes(value) / CHARS_PER_TOKEN);
}

function messagePayload(body) {
  if (Array.isArray(body?.messages)) return body.messages;
  if (Array.isArray(body?.input)) return body.input;
  if (Array.isArray(body?.contents)) return body.contents;
  return [];
}

/**
 * Fit tool schemas into the target model's input-context budget.
 *
 * This deliberately operates on the tool set rather than deleting conversation
 * history. Tool schemas are safe, structured candidates to cull; if the message
 * history alone is already over budget, the caller gets a diagnostic instead of
 * silently destroying conversational state.
 *
 * The estimate is intentionally conservative and dependency-free: JSON bytes / 4.
 * Provider usage is the authority; this is a preflight guard, not a tokenizer.
 */
export function budgetToolsToContext(tools, body, connectionId, capabilities = {}) {
  if (!Array.isArray(tools) || tools.length === 0) return { tools, stats: null };

  const contextWindow = Number(capabilities.contextWindow) || 200000;
  const maxOutput = Number(capabilities.maxOutput) || DEFAULT_OUTPUT_RESERVE;
  const inputBudgetRatio = Number(capabilities.inputBudgetRatio) > 0 && Number(capabilities.inputBudgetRatio) <= 1
    ? Number(capabilities.inputBudgetRatio)
    : DEFAULT_INPUT_BUDGET_RATIO;
  const outputReserve = Math.min(Math.max(maxOutput, 0), DEFAULT_OUTPUT_RESERVE);
  const inputBudgetTokens = Math.max(1, Math.floor(contextWindow * inputBudgetRatio) - outputReserve);
  const messageTokens = estimateTokens(messagePayload(body));
  const toolTokensBefore = estimateTokens(tools);
  const totalTokensBefore = messageTokens + toolTokensBefore;

  const baseStats = {
    changed: false,
    before: tools.length,
    after: tools.length,
    messageTokens,
    toolTokensBefore,
    totalTokensBefore,
    inputBudgetTokens,
    messagesOverBudget: messageTokens > inputBudgetTokens,
  };

  if (totalTokensBefore <= inputBudgetTokens || messageTokens >= inputBudgetTokens) {
    return { tools, stats: baseStats };
  }

  const pinned = extractPinnedNames(body);
  const pinnedCount = tools.filter((tool) => pinned.has(tool?.function?.name || tool?.name)).length;
  if (pinnedCount >= tools.length) return { tools, stats: baseStats };

  let low = Math.max(1, pinnedCount);
  let high = tools.length;
  let best = tools;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = disclosureTools(tools, body, connectionId, { maxTools: mid }).tools;
    const total = messageTokens + estimateTokens(candidate);
    if (total <= inputBudgetTokens) {
      best = candidate;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  const changed = best.length < tools.length;
  return {
    tools: best,
    stats: {
      ...baseStats,
      changed,
      after: best.length,
      toolTokensAfter: estimateTokens(best),
      totalTokensAfter: messageTokens + estimateTokens(best),
      messagesOverBudget: false,
    },
  };
}

export { estimateTokens };
