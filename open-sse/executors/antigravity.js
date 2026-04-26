import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, ANTIGRAVITY_HEADERS, INTERNAL_REQUEST_HEADER, AG_DEFAULT_TOOLS, AG_TOOL_SUFFIX } from "../config/appConstants.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { deriveSessionId } from "../utils/sessionManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const MAX_RETRY_AFTER_MS = 10000;

export class AntigravityExecutor extends BaseExecutor {
  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(model, stream, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  buildHeaders(credentials, stream = true, sessionId = null) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"],
      [INTERNAL_REQUEST_HEADER.name]: INTERNAL_REQUEST_HEADER.value,
      ...(sessionId && { "X-Machine-Session-Id": sessionId }),
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model, body, stream, credentials) {
    const projectId = credentials?.projectId || this.generateProjectId();

    // Fix contents for Claude models via Antigravity
    const contents = body.request?.contents?.map(c => {
      let role = c.role;
      // functionResponse must be role "user" for Claude models
      if (c.parts?.some(p => p.functionResponse)) {
        role = "user";
      }
      // Strip thought-only parts, keep thoughtSignature on functionCall parts (Gemini 3+ requires it)
      const parts = c.parts?.filter(p => {
        if (p.thought && !p.functionCall) return false;
        if (p.thoughtSignature && !p.functionCall && !p.text) return false;
        return true;
      });
      if (role !== c.role || parts?.length !== c.parts?.length) {
        return { ...c, role, parts };
      }
      return c;
    });

    const transformedRequest = {
      ...body.request,
      ...(contents && { contents }),
      sessionId: body.request?.sessionId || deriveSessionId(credentials?.email || credentials?.connectionId),
      safetySettings: undefined,
      toolConfig: body.request?.tools?.length > 0
        ? { functionCallingConfig: { mode: "VALIDATED" } }
        : body.request?.toolConfig
    };

    return {
      ...body,
      project: projectId,
      model: model,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: `agent-${crypto.randomUUID()}`,
      request: transformedRequest
    };
  }

  async refreshCredentials(credentials, log) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      });

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Antigravity refresh error: ${error.message}`);
      return null;
    }
  }

  generateProjectId() {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
  }

  generateSessionId() {
    return crypto.randomUUID() + Date.now().toString();
  }

  parseRetryHeaders(headers) {
    if (!headers?.get) return null;

    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get('x-ratelimit-reset-after');
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get('x-ratelimit-reset');
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  // Parse retry time from Antigravity error message body
  // Format: "Your quota will reset after 2h7m23s" or "1h30m" or "45m" or "30s"
  parseRetryFromErrorMessage(errorMessage) {
    if (!errorMessage || typeof errorMessage !== "string") return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const MAX_AUTO_RETRIES = 3;
    const MAX_RETRY_AFTER_RETRIES = 3;
    const retryAttemptsByUrl = {}; // Track retry attempts per URL
    const retryAfterAttemptsByUrl = {}; // Track Retry-After retries per URL

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const sessionId = transformedBody.request?.sessionId;
      const headers = this.buildHeaders(credentials, stream, sessionId);

      // Initialize retry counters for this URL
      if (!retryAttemptsByUrl[urlIndex]) {
        retryAttemptsByUrl[urlIndex] = 0;
      }
      if (!retryAfterAttemptsByUrl[urlIndex]) {
        retryAfterAttemptsByUrl[urlIndex] = 0;
      }

      try {
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal
        }, proxyOptions);

        if (response.status === HTTP_STATUS.RATE_LIMITED || response.status === HTTP_STATUS.SERVICE_UNAVAILABLE) {
          // Try to get retry time from headers first
          let retryMs = this.parseRetryHeaders(response.headers);

          // If no retry time in headers, try to parse from error message body
          if (!retryMs) {
            try {
              const errorBody = await response.clone().text();
              const errorJson = JSON.parse(errorBody);
              const errorMessage = errorJson?.error?.message || errorJson?.message || "";
              retryMs = this.parseRetryFromErrorMessage(errorMessage);
            } catch (e) {
              // Ignore parse errors, will fall back to exponential backoff
            }
          }

          if (retryMs && retryMs <= MAX_RETRY_AFTER_MS && retryAfterAttemptsByUrl[urlIndex] < MAX_RETRY_AFTER_RETRIES) {
            retryAfterAttemptsByUrl[urlIndex]++;
            log?.debug?.("RETRY", `${response.status} with Retry-After: ${Math.ceil(retryMs / 1000)}s, waiting... (${retryAfterAttemptsByUrl[urlIndex]}/${MAX_RETRY_AFTER_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, retryMs));
            urlIndex--;
            continue;
          }

          // Auto retry only for 429 when retryMs is 0 or undefined
          if (response.status === HTTP_STATUS.RATE_LIMITED && (!retryMs || retryMs === 0) && retryAttemptsByUrl[urlIndex] < MAX_AUTO_RETRIES) {
            retryAttemptsByUrl[urlIndex]++;
            // Exponential backoff: 2s, 4s, 8s...
            const backoffMs = Math.min(1000 * (2 ** retryAttemptsByUrl[urlIndex]), MAX_RETRY_AFTER_MS);
            log?.debug?.("RETRY", `429 auto retry ${retryAttemptsByUrl[urlIndex]}/${MAX_AUTO_RETRIES} after ${backoffMs / 1000}s`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            urlIndex--;
            continue;
          }

          log?.debug?.("RETRY", `${response.status}, Retry-After ${retryMs ? `too long (${Math.ceil(retryMs / 1000)}s)` : 'missing'}, trying fallback`);
          lastStatus = response.status;

          if (urlIndex + 1 < fallbackCount) {
            continue;
          }
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        lastError = error;
        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }

  static stripEnumDescriptions(schema) {
    if (!schema || typeof schema !== "object") return schema;
    const result = Array.isArray(schema) ? [...schema] : { ...schema };
    delete result.enumDescriptions;
    if (result.properties) {
      for (const key of Object.keys(result.properties)) {
        result.properties[key] = this.stripEnumDescriptions(result.properties[key]);
      }
    }
    if (result.items) {
      result.items = this.stripEnumDescriptions(result.items);
    }
    return result;
  }

  /**
   * Cloak tools before sending to Antigravity provider (anti-ban):
   * - Strip enumDescriptions from tool schemas (upstream rejects it with 400)
   * - Rename client tools with _ide suffix
   * - Inject AG default decoy tools after client tools
   * Returns { cloakedBody, toolNameMap } where toolNameMap maps suffixed → original
   */
  static cloakTools(body) {
    const tools = body.request?.tools;
    if (!tools || tools.length === 0) {
      return { cloakedBody: body, toolNameMap: null };
    }

    const toolNameMap = new Map();
    const clientDeclarations = [];

    // First: collect renamed client tools (with enumDescriptions stripped)
    for (const toolGroup of tools) {
      if (!toolGroup.functionDeclarations) continue;

      for (const func of toolGroup.functionDeclarations) {
        // Strip enumDescriptions — VSCode Copilot sends this field but Antigravity API rejects it with 400
        const stripped = func.parameters
          ? { ...func, parameters: AntigravityExecutor.stripEnumDescriptions(func.parameters) }
          : func;

        // Skip if already an AG default tool name
        if (AG_DEFAULT_TOOLS.has(func.name)) {
          clientDeclarations.push(stripped);
          continue;
        }

        const suffixed = `${func.name}${AG_TOOL_SUFFIX}`;
        toolNameMap.set(suffixed, func.name);
        clientDeclarations.push({ ...stripped, name: suffixed });
      }
    }

    // Client tools first, then AG decoy tools
    const allDeclarations = [...clientDeclarations, ...AG_DECOY_TOOLS];

    // Rename tool names in conversation history (contents)
    const cloakedContents = body.request?.contents?.map(msg => {
      if (!msg.parts) return msg;
      
      const cloakedParts = msg.parts.map(part => {
        // Rename functionCall.name
        if (part.functionCall && !AG_DEFAULT_TOOLS.has(part.functionCall.name)) {
          return {
            ...part,
            functionCall: {
              ...part.functionCall,
              name: `${part.functionCall.name}${AG_TOOL_SUFFIX}`
            }
          };
        }
        
        // Rename functionResponse.name
        if (part.functionResponse && !AG_DEFAULT_TOOLS.has(part.functionResponse.name)) {
          return {
            ...part,
            functionResponse: {
              ...part.functionResponse,
              name: `${part.functionResponse.name}${AG_TOOL_SUFFIX}`
            }
          };
        }
        
        return part;
      });
      
      return { ...msg, parts: cloakedParts };
    });

    // Single functionDeclarations group: client tools first, then decoys
    return {
      cloakedBody: {
        ...body,
        request: {
          ...body.request,
          tools: [{ functionDeclarations: allDeclarations }],
          contents: cloakedContents || body.request.contents
        }
      },
      toolNameMap
    };
  }
}

// AG decoy tools — same names as AG native defaults, redirect to _ide suffixed tools
const AG_DECOY_TOOLS = [
  {
    name: "browser_subagent",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "command_status",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "find_by_name",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "generate_image",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "grep_search",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "list_dir",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "list_resources",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "mcp_sequential-thinking_sequentialthinking",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "multi_replace_file_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "notify_user",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "read_resource",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "read_terminal",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "read_url_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "replace_file_content",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "run_command",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "search_web",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "send_command_input",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "task_boundary",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "view_content_chunk",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "view_file",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  },
  {
    name: "write_to_file",
    description: "This tool is currently unavailable.",
    parameters: { type: "OBJECT", properties: {}, required: [] }
  }
];

export default AntigravityExecutor;
