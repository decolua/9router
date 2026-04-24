import { PROVIDERS, type ProviderConfig } from "../config/providers";
import { buildClineHeaders } from "@/shared/utils/clineAuth";

const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

function isOpenAICompatible(provider: string): boolean {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function isAnthropicCompatible(provider: string): boolean {
  return typeof provider === "string" && provider.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

function getOpenAICompatibleType(provider: string): "responses" | "chat" {
  if (!isOpenAICompatible(provider)) return "chat";
  return provider.includes("responses") ? "responses" : "chat";
}

function buildOpenAICompatibleUrl(baseUrl: string, apiType: "responses" | "chat"): string {
  const normalized = baseUrl.replace(/\/$/, "");
  const path = apiType === "responses" ? "/responses" : "/chat/completions";
  return `${normalized}${path}`;
}

function buildAnthropicCompatibleUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  return `${normalized}/messages`;
}

function buildQwenBaseUrl(resourceUrl: string | undefined, fallbackBaseUrl: string | undefined): string {
  const fallback = (fallbackBaseUrl || "").replace(/\/chat\/completions$/, "");
  const raw = typeof resourceUrl === "string" ? resourceUrl.trim() : "";
  if (!raw) return fallback;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return `https://${raw.replace(/\/$/, "")}/v1`;
}

/**
 * Detect request format from body structure
 */
export function detectFormat(body: any): string {
  // OpenAI Responses API
  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) {
    return "openai-responses";
  }

  // Antigravity format
  if (body.request?.contents && body.userAgent === "antigravity") {
    return "antigravity";
  }

  // Gemini format
  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  // OpenAI-specific indicators
  if (
    body.stream_options ||
    body.response_format ||
    body.logprobs !== undefined ||
    body.top_logprobs !== undefined ||
    body.n !== undefined ||
    body.presence_penalty !== undefined ||
    body.frequency_penalty !== undefined ||
    body.logit_bias ||
    body.user
  ) {
    return "openai";
  }

  // Claude format
  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0];
    
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = firstMsg.content[0];
      if (firstContent?.type === "text" && !body.model?.includes("/")) {
        if (body.system || body.anthropic_version) {
          return "claude";
        }
        const hasClaudeImage = firstMsg.content.some((c: any) => 
          c.type === "image" && c.source?.type === "base64"
        );
        const hasOpenAIImage = firstMsg.content.some((c: any) => 
          c.type === "image_url" && c.image_url?.url
        );
        if (hasClaudeImage) return "claude";
        if (hasOpenAIImage) return "openai";
        
        const hasClaudeTool = firstMsg.content.some((c: any) => 
          c.type === "tool_use" || c.type === "tool_result"
        );
        if (hasClaudeTool) return "claude";
      }
    }
    
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  return "openai";
}

/**
 * Get provider config
 */
export function getProviderConfig(provider: string): ProviderConfig {
  if (isOpenAICompatible(provider)) {
    const apiType = getOpenAICompatibleType(provider);
    return {
      ...PROVIDERS.openai,
      format: apiType === "responses" ? "openai-responses" : "openai",
      baseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  if (isAnthropicCompatible(provider)) {
    return {
      ...PROVIDERS.anthropic,
      format: "claude",
      baseUrl: ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  return PROVIDERS[provider] || PROVIDERS.openai;
}

export function getProviderFallbackCount(provider: string): number {
  const config = getProviderConfig(provider);
  return config.baseUrls?.length || 1;
}

export interface ProviderUrlOptions {
  baseUrl?: string;
  baseUrlIndex?: number;
  qwenResourceUrl?: string;
}

/**
 * Build provider URL
 */
export function buildProviderUrl(provider: string, model: string, stream: boolean = true, options: ProviderUrlOptions = {}): string {
  if (isOpenAICompatible(provider)) {
    const apiType = getOpenAICompatibleType(provider);
    const baseUrl = options?.baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl;
    return buildOpenAICompatibleUrl(baseUrl, apiType);
  }
  if (isAnthropicCompatible(provider)) {
    const baseUrl = options?.baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl;
    return buildAnthropicCompatibleUrl(baseUrl);
  }
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
      const urlIndex = options?.baseUrlIndex || 0;
      const baseUrl = config.baseUrls?.[urlIndex] || config.baseUrls?.[0] || config.baseUrl;
      const path = stream ? "/v1internal:streamGenerateContent?alt=sse" : "/v1internal:generateContent";
      return `${baseUrl}${path}`;
    }

    case "codex":
      return config.baseUrl || "";

    case "qwen": {
      const baseUrl = buildQwenBaseUrl(options?.qwenResourceUrl, config.baseUrl);
      return `${baseUrl}/chat/completions`;
    }

    case "github":
      return config.baseUrl || "";

    case "glm":
    case "kimi":
    case "minimax":
      return `${config.baseUrl}?beta=true`;

    default:
      return config.baseUrl || "";
  }
}

/**
 * Build provider headers
 */
export function buildProviderHeaders(provider: string, credentials: any, stream: boolean = true, body: any = null): Record<string, string> {
  const config = getProviderConfig(provider);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...config.headers
  };

  if (isAnthropicCompatible(provider)) {
    if (credentials.apiKey) {
      headers["x-api-key"] = credentials.apiKey;
    } else if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    }
    headers["Anthropic-Version"] = "2023-06-01";
    return headers;
  }

  if (isOpenAICompatible(provider)) {
    const key = credentials.apiKey || credentials.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  }

  switch (provider) {
    case "claude":
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "gemini":
      if (credentials.apiKey) {
        headers["x-goog-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "gemini-cli":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (credentials.projectId) {
        headers["X-Goog-User-Project"] = credentials.projectId;
      }
      break;

    case "antigravity":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (credentials.projectId) {
        headers["X-Goog-User-Project"] = credentials.projectId;
      }
      headers["x-goog-api-client"] = "google-cloud-sdk vscode_cloudshelleditor/0.1";
      break;

    case "codex":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "qwen":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "iflow":
      if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "github":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (credentials.providerSpecificData?.copilotToken) {
        headers["Authorization"] = `Bearer ${credentials.providerSpecificData.copilotToken}`;
      }
      break;

    case "kiro":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    case "cline":
      if (credentials.accessToken) {
        const clineHeaders = buildClineHeaders(credentials.accessToken);
        Object.assign(headers, clineHeaders);
      }
      break;

    case "vertex":
    case "vertex-partner":
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;

    default:
      if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      break;
  }

  return headers;
}

/**
 * Normalize thinking config in request body
 */
export function normalizeThinkingConfig(body: any): void {
  if (!body || typeof body !== "object") return;
  
  // If thinking is enabled but last message is not from user, remove thinking
  // (Anthropic requires thinking to be followed by a user message)
  if (body.thinking && Array.isArray(body.messages) && body.messages.length > 0) {
    const lastMsg = body.messages[body.messages.length - 1];
    if (lastMsg.role !== "user") {
      delete body.thinking;
    }
  }
}

/**
 * Get target format for provider
 */
export function getTargetFormat(provider: string): string {
  if (isOpenAICompatible(provider)) {
    return getOpenAICompatibleType(provider) === "responses" ? "openai-responses" : "openai";
  }
  if (isAnthropicCompatible(provider)) return "claude";
  
  const config = getProviderConfig(provider);
  return config.format || "openai";
}
