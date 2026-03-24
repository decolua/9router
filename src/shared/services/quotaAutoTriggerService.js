import {
  getApiKeys,
  getProviderConnections,
  getSettings,
  updateProviderConnection,
  updateSettings,
} from "@/lib/localDb";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import {
  PROVIDER_ID_TO_ALIAS,
  getModelsByProviderId,
} from "open-sse/config/providerModels.js";
import { getUsageForProvider } from "open-sse/services/usage.js";

export const QUOTA_TARGET_CONNECTION_HEADER = "x-9router-target-connection-id";

const INTERNAL_BASE_URL =
  process.env.BASE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || "20128"}`;

const QUOTA_AUTO_TRIGGER_INTERVAL_MS = 60 * 60 * 1000;
const ANTIGRAVITY_WARMUP_MODEL_IDS = new Set([
  "gemini-3-flash",
  "gemini-3.1-pro-low",
  "claude-sonnet-4-6",
]);

function getProviderPriority(provider) {
  if (provider === "antigravity") return 1;
  if (provider === "kiro") return 2;
  return 3;
}

function sortQuotaConnections(connections) {
  return [...connections].sort((a, b) => {
    const priorityDiff = getProviderPriority(a.provider) - getProviderPriority(b.provider);
    if (priorityDiff !== 0) return priorityDiff;

    const providerDiff = a.provider.localeCompare(b.provider);
    if (providerDiff !== 0) return providerDiff;

    return (a.priority || 999) - (b.priority || 999);
  });
}

function trimErrorMessage(error) {
  if (!error) return "Unknown error";

  const raw = typeof error === "string"
    ? error
    : error?.message || error?.error || "Unknown error";

  return raw.replace(/\s+/g, " ").trim().slice(0, 180) || "Unknown error";
}

function mergeWarmupModels(previousModels = {}, nextModels = {}) {
  return {
    ...previousModels,
    ...nextModels,
  };
}

async function persistWarmupState(connectionId, previousState, patch) {
  const nextState = {
    ...previousState,
    ...patch,
    models: mergeWarmupModels(previousState?.models, patch?.models),
  };

  await updateProviderConnection(connectionId, {
    quotaWarmupState: nextState,
  });

  return nextState;
}

async function getInternalApiKey() {
  const keys = await getApiKeys();
  return keys.find((key) => key.isActive !== false)?.key || null;
}

export function getTargetModelsForConnection(connection) {
  const providerId = connection?.provider;
  if (!providerId) return [];

  const models = getModelsByProviderId(providerId);

  if (providerId === "antigravity") {
    return models
      .filter((model) => ANTIGRAVITY_WARMUP_MODEL_IDS.has(model.id))
      .map((model) => ({
        id: model.id,
        name: model.name || model.id,
        fullModel: `${PROVIDER_ID_TO_ALIAS[providerId] || providerId}/${model.id}`,
      }));
  }

  const firstModel = models[0];
  if (!firstModel) return [];

  return [{
    id: firstModel.id,
    name: firstModel.name || firstModel.id,
    fullModel: `${PROVIDER_ID_TO_ALIAS[providerId] || providerId}/${firstModel.id}`,
  }];
}

function getConnectionLabel(connection) {
  return connection.name || connection.email || connection.provider || connection.id;
}

function getQuotaRemaining(quota) {
  if (!quota || quota.unlimited) return Infinity;
  if (typeof quota.remaining === "number") return quota.remaining;
  if (typeof quota.total === "number" && typeof quota.used === "number") {
    return quota.total - quota.used;
  }
  return null;
}

function analyzeQuotaRefreshability(usage) {
  const quotas = usage?.quotas;
  if (!quotas || typeof quotas !== "object") {
    return {
      shouldWarmup: true,
      skipReason: null,
      exhaustedQuotas: [],
    };
  }

  const entries = Object.entries(quotas);
  const exhaustedQuotas = entries
    .filter(([, quota]) => {
      const remaining = getQuotaRemaining(quota);
      return remaining !== null && remaining <= 0;
    })
    .map(([name]) => name);

  const sessionEntry = entries.find(([name]) => /^session(\s|\(|$)/i.test(name));
  const weeklyEntries = entries.filter(([name]) => /^weekly(\s|\(|$)/i.test(name));

  const sessionRemaining = sessionEntry ? getQuotaRemaining(sessionEntry[1]) : null;
  const hasSessionWindow = sessionRemaining !== null;
  const weeklyRemainingValues = weeklyEntries
    .map(([, quota]) => getQuotaRemaining(quota))
    .filter((value) => value !== null);
  const hasWeeklyWindow = weeklyRemainingValues.length > 0;
  const weeklyRecoverable = weeklyRemainingValues.some((value) => value > 0);

  if (hasWeeklyWindow && !weeklyRecoverable) {
    return {
      shouldWarmup: false,
      skipReason: "quota_exhausted_weekly",
      exhaustedQuotas,
    };
  }

  if (hasSessionWindow && sessionRemaining <= 0) {
    return {
      shouldWarmup: false,
      skipReason: hasWeeklyWindow ? "quota_exhausted_session" : "quota_exhausted_session_only",
      exhaustedQuotas,
    };
  }

  return {
    shouldWarmup: true,
    skipReason: null,
    exhaustedQuotas,
  };
}

export async function getQuotaAutoTriggerConnections() {
  const connections = await getProviderConnections();
  const supportedConnections = connections.filter((connection) =>
    connection.authType === "oauth"
    && connection.isActive !== false
    && USAGE_SUPPORTED_PROVIDERS.includes(connection.provider)
  );

  return sortQuotaConnections(supportedConnections);
}

export async function getQuotaAutoTriggerSnapshot() {
  const settings = await getSettings();
  const connections = await getQuotaAutoTriggerConnections();

  return {
    enabled: settings.quotaAutoTriggerEnabled === true,
    running: false,
    lastRunAt: settings.quotaAutoTriggerLastRunAt || null,
    connections: connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      name: getConnectionLabel(connection),
      warmupState: connection.quotaWarmupState || null,
      targetModels: getTargetModelsForConnection(connection),
    })),
  };
}

async function pingModel({ baseUrl, apiKey, fullModel, connectionId }) {
  const headers = {
    "Content-Type": "application/json",
    [QUOTA_TARGET_CONNECTION_HEADER]: connectionId,
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/api/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: fullModel,
      stream: false,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const data = await response.json().catch(async () => {
      const text = await response.text().catch(() => "");
      return { error: text || `HTTP ${response.status}` };
    });

    throw new Error(trimErrorMessage(data?.error || `HTTP ${response.status}`));
  }

  await response.json().catch(() => null);
}

async function updateConnectionWarmupState(connection, modelResults, startedAt) {
  const previousState = connection.quotaWarmupState || {};
  const previousModels = previousState.models || {};
  const nextModels = { ...previousModels };
  const nextLastSuccessAt = modelResults.every((result) => result.status === "success")
    ? startedAt
    : previousState.lastSuccessAt || null;
  const nextPhase = modelResults.every((result) => result.status === "success")
    ? "success"
    : "error";

  for (const result of modelResults) {
    const previousModelState = previousModels[result.id] || {};
    nextModels[result.id] = {
      ...previousModelState,
      status: result.status,
      lastRunAt: startedAt,
      lastSuccessAt: result.status === "success"
        ? startedAt
        : previousModelState.lastSuccessAt || null,
      lastError: result.status === "error" ? result.error : null,
      lastStatusCode: result.statusCode || null,
      modelName: result.name,
    };
  }

  await updateProviderConnection(connection.id, {
    quotaWarmupState: {
      ...previousState,
      running: false,
      phase: nextPhase,
      currentModelId: null,
      currentModelName: null,
      lastRunAt: startedAt,
      lastSuccessAt: nextLastSuccessAt,
      lastError: nextPhase === "error"
        ? modelResults.find((result) => result.status === "error")?.error || null
        : null,
      models: nextModels,
    },
  });
}

async function runConnectionWarmup({ connection, baseUrl, apiKey }) {
  const startedAt = new Date().toISOString();
  const models = getTargetModelsForConnection(connection);
  let currentState = await persistWarmupState(connection.id, connection.quotaWarmupState || {}, {
    running: true,
    phase: "running",
    currentModelId: null,
    currentModelName: null,
    lastRunAt: startedAt,
    lastError: null,
    skipped: false,
    skipReason: null,
    exhaustedQuotas: [],
  });

  if (models.length === 0) {
    await updateProviderConnection(connection.id, {
      quotaWarmupState: {
        ...currentState,
        running: false,
        phase: "success",
        currentModelId: null,
        currentModelName: null,
        lastRunAt: startedAt,
        lastSuccessAt: startedAt,
      },
    });
    return;
  }

  const usage = await getUsageForProvider(connection).catch((error) => ({
    message: trimErrorMessage(error),
  }));
  const quotaDecision = analyzeQuotaRefreshability(usage);
  if (!quotaDecision.shouldWarmup) {
    await updateProviderConnection(connection.id, {
      quotaWarmupState: {
        ...currentState,
        running: false,
        phase: "success",
        currentModelId: null,
        currentModelName: null,
        lastRunAt: startedAt,
        skipped: true,
        skipReason: quotaDecision.skipReason || "quota_exhausted",
        exhaustedQuotas: quotaDecision.exhaustedQuotas,
      },
    });
    return;
  }

  currentState = await persistWarmupState(connection.id, currentState, {
    skipped: false,
    skipReason: null,
    exhaustedQuotas: quotaDecision.exhaustedQuotas,
  });

  const results = [];
  for (const model of models) {
    const previousModelState = currentState.models?.[model.id] || {};
    currentState = await persistWarmupState(connection.id, currentState, {
      running: true,
      phase: "running",
      currentModelId: model.id,
      currentModelName: model.name,
      models: {
        [model.id]: {
          ...previousModelState,
          status: "running",
          lastRunAt: startedAt,
          lastError: null,
          modelName: model.name,
        },
      },
    });

    try {
      await pingModel({
        baseUrl,
        apiKey,
        fullModel: model.fullModel,
        connectionId: connection.id,
      });
      results.push({ id: model.id, name: model.name, status: "success", error: null });
    } catch (error) {
      results.push({
        id: model.id,
        name: model.name,
        status: "error",
        error: trimErrorMessage(error),
      });
    }
  }

  await updateConnectionWarmupState({
    ...connection,
    quotaWarmupState: currentState,
  }, results, startedAt);
}

export class QuotaAutoTriggerService {
  constructor() {
    this.intervalId = null;
    this.runningPromise = null;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.intervalId = setInterval(() => {
      this.run({ reason: "interval" }).catch((error) => {
        console.error("[QuotaAutoTrigger] Interval run failed:", error);
      });
    }, QUOTA_AUTO_TRIGGER_INTERVAL_MS);

    if (this.intervalId?.unref) {
      this.intervalId.unref();
    }

    this.run({ reason: "startup" }).catch((error) => {
      console.error("[QuotaAutoTrigger] Startup run failed:", error);
    });
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.started = false;
  }

  isRunning() {
    return this.runningPromise !== null;
  }

  async run({ reason = "manual", force = false } = {}) {
    if (this.runningPromise) {
      return this.runningPromise;
    }

    this.runningPromise = this.#runInternal({ reason, force })
      .finally(() => {
        this.runningPromise = null;
      });

    return this.runningPromise;
  }

  async #runInternal({ reason, force }) {
    const settings = await getSettings();
    if (!force && settings.quotaAutoTriggerEnabled !== true) {
      return { skipped: true, reason: "disabled" };
    }

    const connections = await getQuotaAutoTriggerConnections();
    if (connections.length === 0) {
      await updateSettings({ quotaAutoTriggerLastRunAt: new Date().toISOString() });
      return { skipped: true, reason: "no-connections" };
    }

    const apiKey = await getInternalApiKey();
    const baseUrl = INTERNAL_BASE_URL;

    for (const connection of connections) {
      try {
        await runConnectionWarmup({ connection, baseUrl, apiKey });
      } catch (error) {
        console.error(
          `[QuotaAutoTrigger] ${reason} failed for ${connection.provider}/${connection.id}:`,
          error
        );
      }
    }

    const lastRunAt = new Date().toISOString();
    await updateSettings({ quotaAutoTriggerLastRunAt: lastRunAt });
    return { ok: true, lastRunAt };
  }
}

let quotaAutoTriggerService = null;

export function getQuotaAutoTriggerService() {
  if (!quotaAutoTriggerService) {
    quotaAutoTriggerService = new QuotaAutoTriggerService();
  }
  return quotaAutoTriggerService;
}
