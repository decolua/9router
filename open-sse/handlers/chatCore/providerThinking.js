/**
 * Apply provider-level thinking/reasoning overrides.
 * Pure function — does not mutate the input body.
 */
export function applyProviderThinkingOverride({ body, provider, model, providerThinking }) {
  // DeepSeek models reject developer role — convert to system before dispatch
  const isOcgDeepseek = provider === "opencode-go" && model?.startsWith("deepseek-v4");
  if (isOcgDeepseek && Array.isArray(body.messages)) {
    body = {
      ...body,
      messages: body.messages.map((m) => m.role === "developer" ? { ...m, role: "system" } : m),
    };
  }

  if (!providerThinking?.mode || providerThinking.mode === "auto") return body;

  const mode = providerThinking.mode;

  // Extended thinking: on/off toggle
  if (mode === "on" && !body.thinking) {
    return { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
  }
  if (mode === "off" && !body.thinking) {
    return { ...body, thinking: { type: "disabled" } };
  }

  // DeepSeek V4 Pro: effort modes require both thinking.enabled AND reasoning_effort
  const isOcgDeepseekV4Pro = provider === "opencode-go" && model === "deepseek-v4-pro";
  if (isOcgDeepseekV4Pro) {
    const withThinking = body.thinking ? body : { ...body, thinking: { type: "enabled" } };
    return withThinking.reasoning_effort ? withThinking : { ...withThinking, reasoning_effort: mode };
  }

  // Generic effort: just set reasoning_effort
  return body.reasoning_effort ? body : { ...body, reasoning_effort: mode };
}
