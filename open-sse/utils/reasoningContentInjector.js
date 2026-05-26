// Some thinking-mode providers (DeepSeek, Kimi, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.

const PLACEHOLDER = " ";

// Provider-level rules: keyed by executor.provider
const PROVIDER_RULES = {
  deepseek: { scope: "all" }
};

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: m => m?.startsWith?.("kimi-"), scope: "toolCalls" },
  { match: m => m?.startsWith?.("deepseek-"), scope: "all" }
];

// Suffix → thinking config mapping for DeepSeek models.
// When a model like "deepseek-r1-max" is specified, the suffix (-max) is stripped
// from the upstream model name and used to configure thinking mode + effort.
const DEEPSEEK_SUFFIX_CONFIG = {
  none:  { thinkingType: "disabled", reasoningEffort: null },
  low:   { thinkingType: "enabled",  reasoningEffort: "low" },
  medium:{ thinkingType: "enabled",  reasoningEffort: "medium" },
  high:  { thinkingType: "enabled",  reasoningEffort: "high" },
  max:   { thinkingType: "enabled",  reasoningEffort: "max" },
};

const DEEPSEEK_SUFFIX_PATTERN = /^(deepseek-.+?)-?(none|low|medium|high|max)$/;

function shouldInject(message, scope) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyRule(body, rule) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map(m =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

/**
 * Parse and apply DeepSeek model suffix for thinking control.
 * Supports any model matching /deepseek-.+/ with suffix: none/low/medium/high/max.
 * Example: "deepseek-r1-max" → upstream model "deepseek-r1" + thinking enabled + effort=max.
 */
function applyDeepSeekModelSuffix({ provider, model, body }) {
  if (provider !== "deepseek" || !body) return body;

  const match = model?.match?.(DEEPSEEK_SUFFIX_PATTERN);
  if (!match) return body;

  const baseModel = match[1];
  const suffix = match[2];
  const config = DEEPSEEK_SUFFIX_CONFIG[suffix];
  if (!config) return body;

  const nextBody = { ...body, model: baseModel };

  if (config.thinkingType) {
    nextBody.extra_body = {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: config.thinkingType
      }
    };
  }

  if (config.reasoningEffort) {
    nextBody.reasoning_effort = config.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

export function injectReasoningContent({ provider, model, body }) {
  const providerRule = PROVIDER_RULES[provider];
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  const nextBody = applyDeepSeekModelSuffix({ provider, model, body });
  // If thinking is explicitly disabled (body.thinking.type=disabled),
  // skip reasoning_content injection to avoid upstream confusion
  const thinkingDisabled = nextBody?.thinking?.type === "disabled" ||
    nextBody?.extra_body?.thinking?.type === "disabled";
  if (thinkingDisabled) return nextBody;
  return applyRule(nextBody, rule);
}
