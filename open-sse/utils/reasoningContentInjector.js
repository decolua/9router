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

function shouldInject(message, scope) {
  if (message?.role !== "assistant" || "reasoning_content" in message) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls);
  return true;
}

function applyRule(body, rule) {
  if (!rule || !body?.messages) return body;
  const messages = body.messages.map(m =>
    shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

export function injectReasoningContent({ provider, model, body }) {
  const providerRule = PROVIDER_RULES[provider];
  const modelRule = MODEL_RULES.find(r => r.match(model));
  const rule = providerRule || modelRule;
  return applyRule(body, rule);
}
