import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

// Global cache for sessions and runs to persist across requests in the process
const sessionCache = {
  // token -> { instanceId, expiresAt }
};
const runCache = {
  // token: { agentId -> { runId, startedAt } }
};

// Model to Agent ID mapping based on common/src/constants/free-agents.ts
const MODEL_TO_AGENT = {
  "deepseek/deepseek-v4-pro": "base2-free-deepseek",
  "moonshotai/kimi-k2.6": "base2-free-kimi",
  "deepseek/deepseek-v4-flash": "base2-free-deepseek-flash",
  "minimax/minimax-m2.7": "base2-free",
};

export class FreebuffExecutor extends BaseExecutor {
  constructor() {
    super("freebuff", PROVIDERS.freebuff || {
      baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
      format: "openai",
      headers: {
        "User-Agent": "ai-sdk/openai-compatible/1.0.25/codebuff",
      }
    });
  }

  async deleteSession(token, proxyOptions) {
    const url = "https://www.codebuff.com/api/v1/freebuff/session";
    try {
      const response = await proxyAwareFetch(url, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`,
          "User-Agent": this.config.headers["User-Agent"]
        }
      }, proxyOptions);
      if (!response.ok) {
        console.warn("[FreebuffExecutor] Failed to delete active session on server:", await response.text());
      }
    } catch (error) {
      console.warn("[FreebuffExecutor] Error deleting session on server:", error.message);
    }
  }

  async getSession(token, model, proxyOptions) {
    let session = sessionCache[token];
    const now = Date.now();

    // Check if session is cached, valid, and matches the requested model
    if (session && 
        session.instanceId && 
        session.model === model && 
        session.expiresAt && 
        (new Date(session.expiresAt).getTime() - now > 60000)) {
      return session.instanceId;
    }

    // If there's a session but the model doesn't match, clear the cache and delete on server
    if (session && session.model !== model) {
      delete sessionCache[token];
      await this.deleteSession(token, proxyOptions);
    } else {
      delete sessionCache[token];
    }

    // Otherwise, create/refresh session
    const url = "https://www.codebuff.com/api/v1/freebuff/session";
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": this.config.headers["User-Agent"]
    };
    if (model) {
      headers["x-freebuff-model"] = model;
    }

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: headers,
      body: "{}"
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to acquire upstream freebuff session: ${errorText}`);
    }

    const data = await response.json();
    if (!data.status) {
      throw new Error("Freebuff session response missing status");
    }

    const status = String(data.status).trim();
    if (status === "disabled") {
      throw new Error("Freebuff session is disabled");
    }

    if (status === "queued") {
      const position = data.position || 1;
      const depth = data.queueDepth || position;
      const waitMs = data.estimatedWaitMs || 5000;
      const retryAfterSec = Math.max(1, Math.round(waitMs / 1000));

      const error = new Error(`Freebuff waiting room queued (position ${position}/${depth})`);
      error.status = 503;
      error.retryAfter = retryAfterSec;
      throw error;
    }

    if (status === "active") {
      if (!data.instanceId) {
        throw new Error("Freebuff session active response missing instanceId");
      }

      sessionCache[token] = {
        instanceId: data.instanceId,
        expiresAt: data.expiresAt || null,
        model: model
      };
      return data.instanceId;
    }

    throw new Error(`Unexpected freebuff session status: ${status}`);
  }

  async getRun(token, agentId, proxyOptions) {
    if (!runCache[token]) {
      runCache[token] = {};
    }

    const now = Date.now();
    const run = runCache[token][agentId];
    // Rotate every 6 hours (6 * 3600 * 1000 ms)
    if (run && run.runId && (now - run.startedAt < 6 * 3600 * 1000)) {
      return run.runId;
    }

    // Start run
    const url = "https://www.codebuff.com/api/v1/agent-runs";
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": this.config.headers["User-Agent"]
      },
      body: JSON.stringify({
        action: "START",
        agentId: agentId
      })
    }, proxyOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to start freebuff agent run: ${errorText}`);
    }

    const data = await response.json();
    if (!data.runId) {
      throw new Error("Freebuff start run response missing runId");
    }

    runCache[token][agentId] = {
      runId: data.runId,
      startedAt: now
    };
    return data.runId;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "Authorization": `Bearer ${credentials.accessToken || credentials.apiKey}`
    };
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }
    return headers;
  }

  async execute(options) {
    const { model, body, stream, credentials, signal, log, proxyOptions } = options;

    const token = credentials.accessToken || credentials.apiKey;
    let sessionInstanceId;
    try {
      sessionInstanceId = await this.getSession(token, model, proxyOptions);
    } catch (error) {
      // Clear session cache on failure so we don't get stuck with a bad session
      delete sessionCache[token];

      const errMsg = error.message || "";
      if (errMsg.includes("model_locked")) {
        log?.info?.("FREEBUFF", `Model locked on server, deleting session on server and retrying`);
        await this.deleteSession(token, proxyOptions);
        sessionInstanceId = await this.getSession(token, model, proxyOptions);
      } else if (error.status === 503) {
        log?.warn?.("FREEBUFF", `Waiting room queued: retry in ${error.retryAfter}s`);
        // Return 503 response matching execution retry/failure expectations
        const dummyResponse = {
          ok: false,
          status: 503,
          headers: new Headers({ "Retry-After": String(error.retryAfter) }),
          text: async () => JSON.stringify({ error: { message: error.message, type: "waiting_room_queued" } })
        };
        return { response: dummyResponse, url: this.config.baseUrl, headers: {}, transformedBody: body };
      } else {
        throw error;
      }
    }

    const agentId = MODEL_TO_AGENT[model] || "base2-free";
    const runId = await this.getRun(token, agentId, proxyOptions);

    const clientId = Math.random().toString(36).substring(2, 15);
    const authMethod = credentials?.providerSpecificData?.authMethod || "freebuff";
    const codebuff_metadata = body.codebuff_metadata || {};
    codebuff_metadata.run_id = runId;
    codebuff_metadata.cost_mode = authMethod === "codebuff" ? "paid" : "free";
    codebuff_metadata.client_id = clientId;
    if (sessionInstanceId) {
      codebuff_metadata.freebuff_instance_id = sessionInstanceId;
    }
    body.codebuff_metadata = codebuff_metadata;
    body.model = model;

    try {
      const result = await super.execute(options);
      // Check if response is not ok and requires session invalidation / retry
      if (!result.response.ok) {
        const clonedResponse = result.response.clone();
        const errorText = await clonedResponse.text();
        if (errorText.includes("freebuff_update_required") ||
          errorText.includes("waiting_room_required") ||
          errorText.includes("waiting_room_queued") ||
          errorText.includes("session_superseded") ||
          errorText.includes("session_expired") ||
          errorText.includes("session_model_mismatch")) {

          log?.info?.("FREEBUFF", `Session invalid (${errorText.slice(0, 100)}), clearing cache, deleting on server and retrying`);
          delete sessionCache[token];

          // Delete active session on server to clear any model lock
          await this.deleteSession(token, proxyOptions);

          // Re-fetch session
          sessionInstanceId = await this.getSession(token, model, proxyOptions);
          body.codebuff_metadata.freebuff_instance_id = sessionInstanceId;

          return super.execute(options);
        }
      }
      return result;
    } catch (error) {
      throw error;
    }
  }
}

export default FreebuffExecutor;
