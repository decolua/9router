/**
 * Get capability profile for a model.
 */
export function getModelCapabilities(provider, modelId) {
  // Default capability profile
  const caps = {
    thinking: {
      supported: true,
      supportsType: true,
      incompatibleWithRequiredToolChoice: false
    },
    reasoningEffort: { supported: true },
    toolChoice: { required: true },
    maxTokens: { field: "max_tokens" }, // "max_tokens", "max_completion_tokens", or "strip"
    temperature: { supported: true },
    stripParams: []
  };

  // Provider & Model specific overrides

  // Gemini (antigravity) overrides
  if (provider === "antigravity" && modelId === "gemini-3-flash") {
    caps.thinking.supported = false;
    caps.reasoningEffort.supported = false;
  }

  // GitHub overrides (simulate github.js rules)
  if (provider === "github") {
    if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("gpt-4.5") || modelId.includes("gpt-5") || modelId.includes("gpt-4o")) {
      caps.maxTokens.field = "max_completion_tokens";
    }
    // Simple mock of supportsThinking() / supportsReasoningEffort() logic
    if (modelId.includes("gpt-5.4-mini") || modelId.includes("gpt-5.5")) {
      caps.temperature.supported = false;
    }
    if (modelId.includes("claude")) {
      caps.thinking.supported = false;
    }
  }

  // Qwen overrides
  if (provider === "qwen" || modelId.includes("qwen")) {
    caps.thinking.incompatibleWithRequiredToolChoice = true;
  }

  // Grok overrides
  if (provider === "grok-web") {
    if (["grok-3", "grok-4", "grok-4.1-fast", "grok-4.2", "grok-4.20"].includes(modelId)) {
      caps.thinking.supported = false;
    }
  }

  // Kiro overrides
  if (provider === "kiro" || provider === "kiro-router") {
    // Conservative default for Kiro
    if (modelId.includes("claude-haiku-4.5-agentic") || modelId.includes("claude-sonnet-4.5-thinking")) {
      // Some kiro synthetic models might not natively support the standard thinking body param.
      caps.thinking.supported = false;
      caps.reasoningEffort.supported = false;
    }
  }

  return caps;
}

/**
 * Deep copies and sanitizes the request body based on the model's capabilities.
 */
export function sanitizeBodyForModel(originalBody, caps) {
  // Isolate body to prevent poisoning combo chains
  const body = JSON.parse(JSON.stringify(originalBody));

  // Handle Qwen-style thinking + tool_choice conflict
  if (caps.thinking?.incompatibleWithRequiredToolChoice && body.tool_choice === "required") {
    body.tool_choice = "auto";
    if (body.thinking) {
      delete body.thinking;
    }
  }

  // Handle thinking and reasoning_effort support
  if (caps.thinking?.supported === false) {
    delete body.thinking;
    delete body.reasoning_effort;
  } else if (caps.thinking?.supportsType === false && body.thinking?.type) {
    delete body.thinking.type;
  }

  if (caps.reasoningEffort?.supported === false) {
    delete body.reasoning_effort;
  }

  // Handle max_tokens conversion/stripping
  if (caps.maxTokens?.field === "max_completion_tokens" && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  } else if (caps.maxTokens?.field === "strip") {
    delete body.max_tokens;
    delete body.max_completion_tokens;
  }

  // Handle temperature support
  if (caps.temperature?.supported === false) {
    delete body.temperature;
    delete body.top_p;
  }

  // Strip arbitrary extra params
  if (caps.stripParams && caps.stripParams.length > 0) {
    caps.stripParams.forEach(param => {
      delete body[param];
    });
  }

  return body;
}
