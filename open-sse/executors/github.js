import { BaseExecutor } from "./base.js";
import { PROVIDERS, OAUTH_ENDPOINTS, HTTP_STATUS, GITHUB_COPILOT } from "../config/constants.js";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses.js";
import { openaiResponsesToOpenAIResponse } from "../translator/response/openai-responses.js";
import { initState } from "../translator/index.js";
import { parseSSELine, formatSSE } from "../utils/streamHelpers.js";
import crypto from "crypto";

export class GithubExecutor extends BaseExecutor {
  constructor() {
    super("github", PROVIDERS.github);
    this.knownCodexModels = new Set();
  }

  buildUrl(model, stream, urlIndex = 0) {
    return this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const token = credentials.copilotToken || credentials.accessToken;
    return {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "copilot-integration-id": "vscode-chat",
      "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
      "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
      "user-agent": GITHUB_COPILOT.USER_AGENT,
      "openai-intent": "conversation-panel",
      "x-github-api-version": GITHUB_COPILOT.API_VERSION,
      "x-request-id": crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "x-vscode-user-agent-library-version": "electron-fetch",
      "X-Initiator": "user",
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  // Sanitize messages for GitHub Copilot /chat/completions endpoint.
  // The endpoint only accepts 'text' and 'image_url' content part types.
  // Tool-related content (tool_use, tool_result, thinking) must be serialized as text.
  sanitizeMessagesForChatCompletions(body) {
    if (!body?.messages) return body;

    const sanitized = { ...body };
    sanitized.messages = body.messages.map(msg => {
      // assistant messages with only tool_calls have content: null — leave as-is
      if (!msg.content) return msg;

      // String content is always fine
      if (typeof msg.content === "string") return msg;

      // Array content: filter/convert unsupported part types
      if (Array.isArray(msg.content)) {
        const cleanContent = msg.content
          .map(part => {
            if (part.type === "text") return part;
            if (part.type === "image_url") return part;
            // Serialize tool_use, tool_result, thinking, etc. as text
            const text = part.text || part.content || JSON.stringify(part);
            return { type: "text", text: typeof text === "string" ? text : JSON.stringify(text) };
          })
          .filter(part => part.text !== ""); // remove empty text parts

        // If all content was stripped (e.g. only tool_result with no text), drop content
        return { ...msg, content: cleanContent.length > 0 ? cleanContent : null };
      }

      return msg;
    });

    return sanitized;
  }

  async execute(options) {
    const { model, log } = options;

    // Only use /responses for models that are explicitly known to need it (e.g. gpt codex models)
    if (this.knownCodexModels.has(model)) {
      log?.debug("GITHUB", `Using cached /responses route for ${model}`);
      return this.executeWithResponsesEndpoint(options);
    }

    // Sanitize messages before sending to /chat/completions
    // This handles Claude models on GitHub Copilot which reject non-text/image_url content types
    const sanitizedOptions = {
      ...options,
      body: this.sanitizeMessagesForChatCompletions(options.body)
    };

    const result = await super.execute(sanitizedOptions);

    if (result.response.status === HTTP_STATUS.BAD_REQUEST) {
      const errorBody = await result.response.clone().text();

      if (errorBody.includes("not accessible via the /chat/completions endpoint")) {
        log?.warn("GITHUB", `Model ${model} requires /responses. Switching...`);
        this.knownCodexModels.add(model);
        return this.executeWithResponsesEndpoint(options);
      }
    }

    return result;
  }

  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log }) {
    const url = this.config.responsesUrl;
    const headers = this.buildHeaders(credentials, stream);

    const transformedBody = openaiToOpenAIResponsesRequest(model, body, stream, credentials);

    log?.debug("GITHUB", "Sending translated request to /responses");

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    });

    if (!response.ok) {
      return { response, url, headers, transformedBody };
    }

    const state = initState("openai-responses");
    state.model = model;

    const decoder = new TextDecoder();
    let buffer = "";

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");

        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;

          if (parsed.done) {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            continue;
          }

          const converted = openaiResponsesToOpenAIResponse(parsed, state);
          if (converted) {
            const sseString = formatSSE(converted, "openai");
            controller.enqueue(new TextEncoder().encode(sseString));
          }
        }
      },
      flush(controller) {
        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const converted = openaiResponsesToOpenAIResponse(parsed, state);
            if (converted) {
              controller.enqueue(new TextEncoder().encode(formatSSE(converted, "openai")));
            }
          }
        }
      }
    });

    const convertedStream = response.body.pipeThrough(transformStream);

    return {
      response: new Response(convertedStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      }),
      url,
      headers,
      transformedBody
    };
  }

  async refreshCopilotToken(githubAccessToken, log) {
    try {
      const response = await fetch("https://api.github.com/copilot_internal/v2/token", {
        headers: {
          "Authorization": `token ${githubAccessToken}`,
          "User-Agent": GITHUB_COPILOT.USER_AGENT,
          "Editor-Version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
          "Editor-Plugin-Version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
          "Accept": "application/json",
          "x-github-api-version": GITHUB_COPILOT.API_VERSION
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN", `Copilot token refresh failed: ${response.status} ${errorText}`);
        return null;
      }
      const data = await response.json();
      log?.info?.("TOKEN", "Copilot token refreshed");
      return { token: data.token, expiresAt: data.expires_at };
    } catch (error) {
      log?.error?.("TOKEN", `Copilot refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshGitHubToken(refreshToken, log) {
    try {
      const response = await fetch(OAUTH_ENDPOINTS.github.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });
      if (!response.ok) return null;
      const tokens = await response.json();
      log?.info?.("TOKEN", "GitHub token refreshed");
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
    } catch (error) {
      log?.error?.("TOKEN", `GitHub refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshCredentials(credentials, log) {
    let copilotResult = await this.refreshCopilotToken(credentials.accessToken, log);

    if (!copilotResult && credentials.refreshToken) {
      const githubTokens = await this.refreshGitHubToken(credentials.refreshToken, log);
      if (githubTokens?.accessToken) {
        copilotResult = await this.refreshCopilotToken(githubTokens.accessToken, log);
        if (copilotResult) {
          return { ...githubTokens, copilotToken: copilotResult.token, copilotTokenExpiresAt: copilotResult.expiresAt };
        }
        return githubTokens;
      }
    }

    if (copilotResult) {
      return { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, copilotToken: copilotResult.token, copilotTokenExpiresAt: copilotResult.expiresAt };
    }

    return null;
  }

  needsRefresh(credentials) {
    // Always refresh if no copilotToken
    if (!credentials.copilotToken) return true;

    if (credentials.copilotTokenExpiresAt) {
      // Handle both Unix timestamp (seconds) and ISO string
      let expiresAtMs = credentials.copilotTokenExpiresAt;
      if (typeof expiresAtMs === "number" && expiresAtMs < 1e12) {
        expiresAtMs = expiresAtMs * 1000; // Convert seconds to ms
      } else if (typeof expiresAtMs === "string") {
        expiresAtMs = new Date(expiresAtMs).getTime();
      }
      if (expiresAtMs - Date.now() < 5 * 60 * 1000) return true;
    }
    return super.needsRefresh(credentials);
  }
}

export default GithubExecutor;
