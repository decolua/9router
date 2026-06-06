// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.

const PLACEHOLDER = " ";

// Provider-level rules: keyed by executor.provider
const PROVIDER_RULES = {
  deepseek: { scope: "all" },
  minimax: { scope: "all" },
  "minimax-cn": { scope: "all" }
};

// Model-level rules: matched by predicate against model id
const MODEL_RULES = [
  { match: m => m?.startsWith?.("kimi-"), scope: "toolCalls" },
  { match: m => m?.startsWith?.("deepseek-"), scope: "all" }
];

const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
const DEEPSEEK_V4_PRO_ALIASES = {
  [`${DEEPSEEK_V4_PRO}-max`]: {
    thinkingType: "enabled",
    reasoningEffort: "max"
  },
  [`${DEEPSEEK_V4_PRO}-none`]: {
    thinkingType: "disabled",
    reasoningEffort: null
  }
};

// xAI synthetic reasoning-effort variant: grok-4.3-high maps to the single
// upstream model `grok-4.3` with reasoning_effort=high. xAI has no separate
// reasoning model name — effort is a request parameter.
const GROK_43 = "grok-4.3";
const GROK_43_REASONING_ALIASES = {
  [`${GROK_43}-high`]: "high"
};

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

function applyDeepSeekV4ProAlias({ provider, model, body }) {
  const alias = DEEPSEEK_V4_PRO_ALIASES[model];
  if (provider !== "deepseek" || !alias || !body) return body;

  const nextBody = {
    ...body,
    model: DEEPSEEK_V4_PRO,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: alias.thinkingType
      }
    }
  };

  if (alias.reasoningEffort) {
    nextBody.reasoning_effort = alias.reasoningEffort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

function applyGrok43ReasoningAlias({ provider, model, body }) {
  const effort = GROK_43_REASONING_ALIASES[model];
  if (provider !== "xai" || !effort || !body) return body;
  return {
    ...body,
    model: GROK_43,
    reasoning_effort: effort
  };
}

export function injectReasoningContent({ provider, model, body }) {
  const providerRule = PROVIDER_RULES[provider];
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  let nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  nextBody = applyGrok43ReasoningAlias({ provider, model, body: nextBody });
  return applyRule(nextBody, rule);
}
