import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { GITHUB_COPILOT } from "../config/appConstants";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { openaiToOpenAIResponsesRequest } from "../translator/request/openai-responses";
import { proxyAwareFetch } from "../utils/proxyFetch";
import crypto from "crypto";

export class GithubExecutor extends BaseExecutor {
  knownCodexModels: Set<string>;

  constructor() {
    super("github", PROVIDERS.github);
    this.knownCodexModels = new Set();
  }

  buildUrl() {
    return this.config.baseUrl;
  }

  buildHeaders(credentials: any, stream = true) {
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

  sanitizeMessagesForChatCompletions(body: any) {
    if (!body?.messages) return body;

    const sanitized = { ...body };
    
    if (body.response_format && body.model?.includes('claude')) {
      const responseFormat = body.response_format;
      let systemInstruction = '';
      if (responseFormat.type === 'json_schema' && responseFormat.json_schema?.schema) {
        systemInstruction = 'CRITICAL: You must ONLY output raw JSON. Never use markdown code blocks. Never use backticks. Never wrap JSON in triple backticks. Output ONLY the raw JSON object.';
      } else if (responseFormat.type === 'json_object') {
        systemInstruction = 'CRITICAL: You must ONLY output raw JSON. Never use markdown code blocks. Never use backticks.';
      }
      if (systemInstruction) {
        // Add to system message
        const systemIdx = body.messages.findIndex((m: any) => m.role === 'system');
        if (systemIdx >= 0) {
          body.messages[systemIdx].content = systemInstruction + '\n\n' + body.messages[systemIdx].content;
        } else {
          body.messages.unshift({ role: 'system', content: systemInstruction });
        }
        
        // Also prepend to the last user message as a reminder
        const lastUserIdx = body.messages.map((m: any, i: number) => m.role === 'user' ? i : -1).filter((i: number) => i >= 0).pop();
        if (lastUserIdx !== undefined && lastUserIdx >= 0) {
          const userMsg = body.messages[lastUserIdx];
          const userContent = typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content);
          userMsg.content = 'Respond with ONLY raw JSON (no markdown, no backticks, no code blocks): ' + userContent;
        }
      }
    }
    sanitized.messages = body.messages.map((msg: any) => {
      if (!msg.content) return msg;

      if (typeof msg.content === "string") return msg;

      if (Array.isArray(msg.content)) {
        const cleanContent = msg.content
          .map((part: any) => {
            if (part.type === "text") return part;
            if (part.type === "image_url") return part;
            const text = part.text || part.content || JSON.stringify(part);
            return { type: "text", text: typeof text === "string" ? text : JSON.stringify(text) };
          })
          .filter((part: any) => part.text !== "");

        return { ...msg, content: cleanContent.length > 0 ? cleanContent : null };
      }

      return msg;
    });

    return sanitized;
  }

  requiresMaxCompletionTokens(model: string) {
    return /gpt-5|o[134]-/i.test(model);
  }

  supportsTemperature(model: string) {
    return !/gpt-5\.4/i.test(model);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  supportsThinking(model?: string) {
    return false;
  }

  transformRequest(model: string, body: any, stream: boolean, credentials: any) {
    const transformed = { ...body };
    if (this.requiresMaxCompletionTokens(model) && transformed.max_tokens !== undefined) {
      transformed.max_completion_tokens = transformed.max_tokens;
      delete transformed.max_tokens;
    }
    if (!this.supportsTemperature(model) && transformed.temperature !== undefined) {
      delete transformed.temperature;
    }
    if (!this.supportsThinking(model)) {
      delete transformed.thinking;
      delete transformed.reasoning_effort;
    }
    return transformed;
  }

  async execute(options: any): Promise<any> {
    const { model, log } = options;

    if (this.knownCodexModels.has(model)) {
      log?.debug("GITHUB", `Using cached /responses route for ${model}`);
      return this.executeWithResponsesEndpoint(options);
    }

    const sanitizedOptions = {
      ...options,
      body: this.sanitizeMessagesForChatCompletions(options.body)
    };

    const result = await super.execute({ ...sanitizedOptions, proxyOptions: options.proxyOptions || null });

    if (result.response.status === HTTP_STATUS.BAD_REQUEST) {
      const errorBody = await result.response.clone().text();

      if (errorBody.includes("not accessible via the /chat/completions endpoint") || errorBody.includes("The requested model is not supported")) {
        log?.warn("GITHUB", `Model ${model} requires /responses. Switching...`);
        this.knownCodexModels.add(model);
        return this.executeWithResponsesEndpoint(options);
      }
    }

    return result;
  }

  async executeWithResponsesEndpoint({ model, body, stream, credentials, signal, log, proxyOptions = null }: any): Promise<any> {
    const url = this.config.responsesUrl;
    const headers = this.buildHeaders(credentials, stream);

    const transformedBody = openaiToOpenAIResponsesRequest(model, body, stream, credentials);

    log?.debug("GITHUB", "Sending translated request to /responses");

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(transformedBody),
      signal
    }, proxyOptions);

    return { response, url, headers, transformedBody };
  }
}

export default GithubExecutor;
