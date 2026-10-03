import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import {
  refreshProviderCredentials,
  shouldRefreshCredentials,
} from "../services/oauthCredentialManager.js";
import { getModelUpstreamId } from "../config/providerModels.js";
import {
  GROK_CLI_CLIENT_IDENTIFIER,
  GROK_CLI_VERSION,
  supportsGrokCliReasoningEffort,
} from "../config/grokCli.js";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getConsistentMachineId } from "../shared/machineId.js";
import { dbg } from "../utils/debugLog.js";
import {
  GrokCliCompatibilityError,
  normalizeGrokCliEffort,
  translateGrokCliResponsesRequest,
} from "./grok-cli-compat.js";

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"];
const GROK_CLI_TURN_STORE_MAX = 5000;

// Per-session last turn index so multi-turn headers never go backwards within this process
const sessionTurnStore = new Map();
let requestTurnStore = new WeakMap();
let requestIdStore = new WeakMap();

/**
 * Count user turns in a Responses `input` array.
 * Official CLI sets x-grok-turn-idx to the 1-based conversation turn (≈ user messages).
 * HAR: first chat turn → "1".
 */
export function countGrokCliUserTurns(input) {
  if (!Array.isArray(input)) return 1;
  let n = 0;
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = typeof item.type === "string" ? item.type : "";
    // Responses message items (type omitted or "message") with role user
    if (item.role === "user" && (!type || type === "message")) n += 1;
  }
  return Math.max(1, n);
}

/**
 * Resolve monotonic turn index for a session.
 * Prefers user-message count from the payload (full history clients), but never
 * decreases vs the last index observed for the same sessionId in this process.
 */
export function resolveGrokCliTurnIdx(sessionId, input, requestKey = null) {
  const fromInput = countGrokCliUserTurns(input);
  if (!sessionId) return fromInput;

  if (requestKey && requestTurnStore.has(requestKey)) {
    return requestTurnStore.get(requestKey);
  }

  const now = Date.now();
  const existing = sessionTurnStore.get(sessionId);
  const prev = existing && now - existing.lastUsed <= MEMORY_CONFIG.sessionTtlMs
    ? existing.turn
    : 0;
  if (existing) sessionTurnStore.delete(sessionId);

  // A new delta-style request advances the turn; retries reuse requestKey.
  const turn = prev > 0 ? Math.max(fromInput, prev + (requestKey ? 1 : 0)) : fromInput;
  while (sessionTurnStore.size >= GROK_CLI_TURN_STORE_MAX) {
    sessionTurnStore.delete(sessionTurnStore.keys().next().value);
  }
  sessionTurnStore.set(sessionId, { turn, lastUsed: now });
  if (requestKey) requestTurnStore.set(requestKey, turn);
  return turn;
}

/** Test helper — clear in-memory turn counters */
export function _resetGrokCliTurnStore() {
  sessionTurnStore.clear();
  requestTurnStore = new WeakMap();
  requestIdStore = new WeakMap();
}

export function _getGrokCliTurnStoreSize() {
  return sessionTurnStore.size;
}

export { normalizeGrokCliEffort };
export { supportsGrokCliReasoningEffort } from "../config/grokCli.js";

export function resolveGrokCliSessionId(credentials, body) {
  // ponytail: clients without stable thread metadata share one connection session;
  // split further when their wire format exposes a durable conversation id.
  const explicitSessionBody = {
    prompt_cache_key: body?.prompt_cache_key,
    session_id: body?.session_id,
    conversation_id: body?.conversation_id,
    metadata: body?.metadata,
  };
  return resolveSessionId({
    headers: credentials?.rawHeaders,
    body: explicitSessionBody,
    connectionId: credentials?.connectionId || credentials?.id,
    workspaceId: credentials?.providerSpecificData?.workspaceId,
    scope: "grok-cli",
  });
}

function resolveGrokCliRequestId(requestKey) {
  if (!requestKey || typeof requestKey !== "object") return crypto.randomUUID();
  const existing = requestIdStore.get(requestKey);
  if (existing) return existing;
  const requestId = crypto.randomUUID();
  requestIdStore.set(requestKey, requestId);
  return requestId;
}

function deterministicAgentId(seed) {
  const chars = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][Number.parseInt(chars[16], 16) % 4];
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function resolveGrokCliAgentId(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const stored = psd.deviceId || psd.agentId;
  if (stored) return stored;

  const accountId = credentials?.connectionId || credentials?.id
    || psd.userId || psd.principalId || credentials?.userId || credentials?.providerUserId
    || psd.email || credentials?.email || "anonymous";
  try {
    const machineId = await getConsistentMachineId("grok-cli-agent");
    return deterministicAgentId(`${machineId}\0${accountId}`);
  } catch {
    return crypto.randomUUID();
  }
}

function resolveEffortFromModel(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  for (const level of EFFORT_LEVELS) {
    if (modelId.endsWith(`-${level}`)) return level;
  }
  return null;
}

/**
 * Grok CLI Executor — OpenAI Responses API on cli-chat-proxy.grok.com
 * Auth: OAuth device-code access token (xai-grok-cli).
 */
export class GrokCliExecutor extends BaseExecutor {
  constructor() {
    super("grok-cli", PROVIDERS["grok-cli"]);
    this._currentSessionId = null;
    this._currentReqId = null;
    this._currentTurnIdx = 1;
    this._agentId = null;
  }

  buildUrl() {
    return this.config.baseUrl;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    return refreshProviderCredentials("grok-cli", credentials, log, proxyOptions);
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials("grok-cli", credentials);
  }

  buildHeaders(credentials, stream = true) {
    const headers = super.buildHeaders(credentials, stream);

    // Static fingerprint from registry
    const staticHeaders = this.config.headers || {};
    for (const [k, v] of Object.entries(staticHeaders)) {
      if (v != null && headers[k] === undefined) headers[k] = v;
    }

    headers["x-grok-client-identifier"] =
      this.config.clientIdentifier || headers["x-grok-client-identifier"] || GROK_CLI_CLIENT_IDENTIFIER;
    headers["x-grok-client-version"] =
      this.config.clientVersion || headers["x-grok-client-version"] || GROK_CLI_VERSION;
    headers["X-XAI-Token-Auth"] ||= "xai-grok-cli";
    headers["x-authenticateresponse"] ||= "authenticate-response";
    headers["x-grok-client-mode"] ||= "headless";

    const sessionId = this._currentSessionId || credentials?.connectionId || crypto.randomUUID();
    const reqId = this._currentReqId || crypto.randomUUID();
    headers["x-grok-session-id"] = sessionId;
    // CLI uses the same id for conv + session on chat turns
    headers["x-grok-conv-id"] = sessionId;
    headers["x-grok-req-id"] = reqId;
    headers["x-grok-turn-idx"] = String(this._currentTurnIdx || 1);

    if (this._agentId) headers["x-grok-agent-id"] = this._agentId;

    // Surface model override (CLI always sets this)
    if (this._currentModel) headers["x-grok-model-override"] = this._currentModel;

    const psd = credentials?.providerSpecificData || {};
    const userId = psd.userId || credentials?.userId || credentials?.providerUserId;
    if (userId) headers["x-grok-user-id"] = userId;
    if (psd.deploymentId) headers["x-grok-deployment-id"] = psd.deploymentId;
    delete headers["x-email"];
    delete headers["x-userid"];

    return headers;
  }

  parseError(response, bodyText) {
    // 402 personal-team-blocked:spending-limit → surface as payment/quota for fallback
    if (response.status === 402 && bodyText) {
      try {
        const json = JSON.parse(bodyText);
        const code = json?.code || "";
        const msg = json?.error || json?.message || bodyText;
        return {
          status: 402,
          message: typeof msg === "string" ? msg : bodyText,
          code: typeof code === "string" ? code : undefined,
        };
      } catch {
        /* fall through */
      }
    }
    return super.parseError(response, bodyText);
  }

  transformRequest(model, body, stream, credentials) {
    const requestKey = body;
    this._currentSessionId = resolveGrokCliSessionId(credentials, body);
    this._currentReqId = resolveGrokCliRequestId(requestKey);
    const credentialAgentId =
      credentials?.providerSpecificData?.deviceId ||
      credentials?.providerSpecificData?.agentId ||
      null;
    if (credentialAgentId) this._agentId = credentialAgentId;

    const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const requestedModel = source.model || model;
    const modelEffort = resolveEffortFromModel(requestedModel);
    const suffixlessModel = modelEffort
      ? requestedModel.replace(new RegExp(`-${modelEffort}$`), "")
      : requestedModel;
    const resolvedModel = getModelUpstreamId("gcli", requestedModel)
      || getModelUpstreamId("grok-cli", requestedModel)
      || suffixlessModel;
    this._currentModel = resolvedModel;

    let input = source.input;
    if (input == null && Array.isArray(source.messages)) {
      input = source.messages.map((message) => ({
        type: "message",
        role: message?.role || "user",
        content: typeof message?.content === "string"
          ? message.content
          : JSON.stringify(message?.content ?? ""),
      }));
    }

    const codecSource = {
      ...source,
      model: resolvedModel,
      input,
    };
    if (source.reasoning?.effort == null && source.reasoning_effort == null && modelEffort) {
      codecSource.reasoning_effort = modelEffort;
    }
    const { body: providerBody, diagnostics } = translateGrokCliResponsesRequest(codecSource, {
      model: resolvedModel,
      supportsReasoningEffort: supportsGrokCliReasoningEffort(resolvedModel),
    });
    dbg("GROK_COMPAT", JSON.stringify(diagnostics));

    this._currentTurnIdx = resolveGrokCliTurnIdx(
      this._currentSessionId,
      providerBody.input,
      requestKey,
    );
    return providerBody;
  }

  async execute(args) {
    const agentId = await resolveGrokCliAgentId(args.credentials);
    this._agentId = agentId;
    const credentials = {
      ...(args.credentials || {}),
      providerSpecificData: {
        ...(args.credentials?.providerSpecificData || {}),
        agentId,
      },
    };

    try {
      return await super.execute({ ...args, credentials });
    } catch (error) {
      if (!(error instanceof GrokCliCompatibilityError)) throw error;
      const response = new Response(JSON.stringify({
        error: {
          message: error.message,
          type: "invalid_request_error",
          param: error.path,
          code: "grok_cli_compatibility_error",
        },
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
      return {
        response,
        url: this.buildUrl(args.model, args.stream, 0, credentials),
        headers: {},
        transformedBody: args.body,
      };
    }
  }
}

export default GrokCliExecutor;
