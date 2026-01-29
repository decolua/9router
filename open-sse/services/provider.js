import { PROVIDERS } from "../config/constants.js";

// Detect request format from body structure
export function detectFormat(body) {
  // OpenAI Responses API: has input[] array instead of messages[]
  if (body.input && Array.isArray(body.input)) {
    return "openai-responses";
  }

  // Gemini format: has contents array
  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  // OpenAI-specific indicators (check BEFORE Claude)
  // These fields are OpenAI-specific and never appear in Claude format
  if (
    body.stream_options || // OpenAI streaming options
    body.response_format || // JSON mode, etc.
    body.logprobs !== undefined || // Log probabilities
    body.top_logprobs !== undefined ||
    body.n !== undefined || // Number of completions
    body.presence_penalty !== undefined || // Penalties
    body.frequency_penalty !== undefined ||
    body.logit_bias || // Token biasing
    body.user // User identifier
  ) {
    return "openai";
  }

  // Claude format: messages with content as array of objects with type
  // Claude requires content to be array with specific structure
  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];

    // If content is array, check if it follows Claude structure
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = firstMsg.content[0];

      // Claude format has specific types: text, image, tool_use, tool_result
      // OpenAI multimodal has: text, image_url (note the difference)
      if (firstContent?.type === "text" && !body.model?.includes("/")) {
        // Could be Claude or OpenAI multimodal
        // Check for Claude-specific fields
        if (body.system || body.anthropic_version) {
          return "claude";
        }
        // Check if image format is Claude (source.type) vs OpenAI (image_url.url)
        const hasClaudeImage = firstMsg.content.some((c) => c.type === "image" && c.source?.type === "base64");
        const hasOpenAIImage = firstMsg.content.some((c) => c.type === "image_url" && c.image_url?.url);
        if (hasClaudeImage) return "claude";
        if (hasOpenAIImage) return "openai";

        // If still unclear, check for tool format
        const hasClaudeTool = firstMsg.content.some((c) => c.type === "tool_use" || c.type === "tool_result");
        if (hasClaudeTool) return "claude";
      }
    }

    // If content is string, it's likely OpenAI (Claude also supports this)
    // Check for other Claude-specific indicators
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  // Default to OpenAI format
  return "openai";
}

// Get provider config
export function getProviderConfig(provider) {
  return PROVIDERS[provider] || PROVIDERS.openai;
}

// Get number of fallback URLs for provider (for retry logic)
export function getProviderFallbackCount(provider) {
  const config = getProviderConfig(provider);
  return config.baseUrls?.length || 1;
}

// Build provider URL
export function buildProviderUrl(provider, model, stream = true, options = {}) {
  const config = getProviderConfig(provider);

  switch (provider) {
    case "claude":
      return `${config.baseUrl}?beta=true`;

    case "gemini": {
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `${config.baseUrl}/${model}:${action}`;
    }

    case "gemini-cli": {
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `${config.baseUrl}:${action}`;
    }

    case "antigravity": {
      // Use baseUrlIndex from options or default to 0
      const urlIndex = options?.baseUrlIndex || 0;
      const baseUrl = config.baseUrls[urlIndex] || config.baseUrls[0];
      const path = stream ? "/v1internal:streamGenerateContent?alt=sse" : "/v1internal:generateContent";
      return `${baseUrl}${path}`;
    }

    case "codex":
      return config.baseUrl;

    case "github":
      return config.baseUrl;

    case "glm":
    case "kimi":
    case "minimax":
      // Claude-compatible providers
      return `${config.baseUrl}?beta=true`;

    default:
      return config.baseUrl;
  }
}

// Build provider headers
export function buildProviderHeaders(provider, credentials, stream = true, body = null) {
  const config = getProviderConfig(provider);
  const headers = {
    "Content-Type": "application/json",
    ...config.headers,
  };

  // Add auth header
  switch (provider) {
    case "gemini":
      if (credentials.apiKey) {
        headers["x-goog-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "antigravity":
    case "gemini-cli":
      // Antigravity and Gemini CLI use OAuth access token
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      break;

    case "claude":
      // Claude uses x-api-key header for API key, or Authorization for OAuth
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "github":
      // GitHub Copilot requires special headers to mimic VSCode
      // Prioritize copilotToken from providerSpecificData, fallback to accessToken
      const githubToken = credentials.copilotToken || credentials.accessToken;
      // Add headers in exact same order as test endpoint
      headers["Authorization"] = `Bearer ${githubToken}`;
      headers["Content-Type"] = "application/json";
      headers["copilot-integration-id"] = "vscode-chat";
      headers["editor-version"] = "vscode/1.107.1";
      headers["editor-plugin-version"] = "copilot-chat/0.26.7";
      headers["user-agent"] = "GitHubCopilotChat/0.26.7";
      headers["openai-intent"] = "conversation-panel";
      headers["x-github-api-version"] = "2025-04-01";
      // Generate a UUID for x-request-id (Cloudflare Workers compatible)
      headers["x-request-id"] = crypto.randomUUID
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c == "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
      headers["x-vscode-user-agent-library-version"] = "electron-fetch";
      headers["X-Initiator"] = "user";
      headers["Accept"] = "application/json";
      break;

    case "codex":
    case "qwen":
    case "openai":
    case "openrouter":
      headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
      break;

    case "glm":
    case "kimi":
    case "minimax":
      // Claude-compatible API providers use x-api-key
      headers["x-api-key"] = credentials.apiKey;
      break;

    default:
      headers["Authorization"] = `Bearer ${credentials.apiKey || credentials.accessToken}`;
      break;
  }

  // Stream accept header
  if (stream) {
    headers["Accept"] = "text/event-stream";
  }

  return headers;
}

// Get target format for provider
export function getTargetFormat(provider) {
  const config = getProviderConfig(provider);
  return config.format || "openai";
}

// Check if last message is from user
export function isLastMessageFromUser(body) {
  const messages = body.messages || body.contents;
  if (!messages?.length) return true;
  const lastMsg = messages[messages.length - 1];
  return lastMsg?.role === "user";
}

// Check if request has thinking config
export function hasThinkingConfig(body) {
  return !!(body.reasoning_effort || body.thinking?.type === "enabled");
}

// Normalize thinking config based on last message role
// - If lastMessage is not user → remove thinking config
// - If lastMessage is user AND has thinking config → keep it (force enable)
export function normalizeThinkingConfig(body) {
  if (!isLastMessageFromUser(body)) {
    delete body.reasoning_effort;
    delete body.thinking;
  }
  return body;
}
