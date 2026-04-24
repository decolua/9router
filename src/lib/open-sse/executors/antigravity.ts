import crypto from "crypto";
import { BaseExecutor } from "./base";
import { PROVIDERS } from "../config/providers";
import { ANTIGRAVITY_HEADERS, INTERNAL_REQUEST_HEADER, OAUTH_ENDPOINTS } from "../config/appConstants";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { deriveSessionId } from "../utils/sessionManager";
import { proxyAwareFetch } from "../utils/proxyFetch";

const MAX_RETRY_AFTER_MS = 10000;

export class AntigravityExecutor extends BaseExecutor {
  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(model: string, stream: boolean, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  buildHeaders(credentials: any, stream = true, sessionId: string | null = null) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"],
      [INTERNAL_REQUEST_HEADER.name]: INTERNAL_REQUEST_HEADER.value,
      ...(sessionId && { "X-Machine-Session-Id": sessionId }),
      "Accept": stream ? "text/event-stream" : "application/json"
    };
  }

  transformRequest(model: string, body: any, stream: boolean, credentials: any) {
    const projectId = credentials?.projectId || this.generateProjectId();

    // Fix contents for Claude models via Antigravity
    const contents = body.request?.contents?.map((c: any) => {
      let role = c.role;
      // functionResponse must be role "user" for Claude models
      if (c.parts?.some((p: any) => p.functionResponse)) {
        role = "user";
      }
      // Strip thought-only parts, keep thoughtSignature on functionCall parts (Gemini 3+ requires it)
      const parts = c.parts?.filter((p: any) => {
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

  async refreshCredentials(credentials: any, log?: any): Promise<any> {
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
    } catch (error: any) {
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

  parseRetryHeaders(headers: Headers) {
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
  parseRetryFromErrorMessage(errorMessage: string) {
    if (!errorMessage || typeof errorMessage !== "string") return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  static cloakTools(body: any) {
    if (!body?.request?.tools?.[0]?.functionDeclarations) {
      return { cloakedBody: body, toolNameMap: null };
    }

    const toolNameMap = new Map<string, string>();
    const nextBody = structuredClone(body);
    const declarations = nextBody.request.tools[0].functionDeclarations;

    for (const decl of declarations) {
      const originalName = decl.name;
      // Real Antigravity uses simple lowercase names for its internal tools
      const cloakedName = originalName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (cloakedName !== originalName) {
        decl.name = cloakedName;
        toolNameMap.set(cloakedName, originalName);
      }
    }

    // Also update any tool calls in history if present (rare for input)
    if (nextBody.request.contents) {
      for (const content of nextBody.request.contents) {
        for (const part of content.parts) {
          if (part.functionCall) {
            const originalName = part.functionCall.name;
            const cloakedName = originalName.toLowerCase().replace(/[^a-z0-9]/g, "_");
            if (cloakedName !== originalName) {
              part.functionCall.name = cloakedName;
            }
          }
        }
      }
    }

    return { cloakedBody: nextBody, toolNameMap };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: any): Promise<any> {
    const fallbackCount = this.getFallbackCount();
    let lastError: any = null;
    let lastStatus = 0;
    const MAX_RETRY_AFTER_RETRIES = 3;
    const retryAttemptsByUrl: Record<number, number> = {}; // Track retry attempts per URL
    const retryAfterAttemptsByUrl: Record<number, number> = {}; // Track Retry-After retries per URL

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
            log?.debug?.("RETRY", `${response.status} with Retry-After: ${retryMs}ms on ${url}, attempt ${retryAfterAttemptsByUrl[urlIndex]}`);
            await new Promise(resolve => setTimeout(resolve, retryMs));
            urlIndex--; // Retry same URL
            continue;
          }
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error: any) {
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
}

export default AntigravityExecutor;
