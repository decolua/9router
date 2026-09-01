import {
  getProviderConnections,
} from "../db/index.js";

import REGISTRY from "open-sse/providers/registry/index.js";

import {
  getProviderModels,
  PROVIDER_ID_TO_ALIAS,
} from "open-sse/config/providerModels.js";

import {
  classifyModelCapabilities,
} from "./capabilities.js";

import {
  canonicalModelId,
  getModelHealth,
  getModelInventorySnapshot,
  getRefreshInFlight,
  setModelHealth,
  setModelInventorySnapshot,
  setRefreshInFlight,
} from "./state.js";

export const MODEL_INVENTORY_REFRESH_MS =
  60 * 60 * 1000;

const DYNAMIC_DISCOVERY_TIMEOUT_MS =
  15_000;

function registryEntries() {
  if (Array.isArray(REGISTRY)) {
    return REGISTRY;
  }

  if (
    REGISTRY &&
    Array.isArray(REGISTRY.providers)
  ) {
    return REGISTRY.providers;
  }

  if (
    REGISTRY &&
    typeof REGISTRY === "object"
  ) {
    return Object.entries(REGISTRY)
      .filter(([, value]) => {
        return value && typeof value === "object";
      })
      .map(([key, value]) => ({
        ...value,
        id: value.id || key,
      }));
  }

  return [];
}

function categoryOf(entry) {
  return String(
    entry?.category ||
    entry?.providerCategory ||
    entry?.type ||
    "",
  ).toLowerCase();
}

function isConnectionlessFree(entry) {
  if (!entry) {
    return false;
  }

  if (
    entry.enabled === false ||
    entry.disabled === true
  ) {
    return false;
  }

  if (
    entry.requiresConnection === false ||
    entry.connectionRequired === false
  ) {
    return true;
  }

  const authModes =
    Array.isArray(entry.authModes)
      ? entry.authModes.map(
          (value) =>
            String(value).toLowerCase(),
        )
      : [];

  if (
    authModes.includes("none") ||
    authModes.includes("anonymous") ||
    authModes.includes("free")
  ) {
    return true;
  }

  return categoryOf(entry).includes("free");
}

function normalizeModel(model) {
  if (typeof model === "string") {
    return {
      id: model,
      name: model,
    };
  }

  if (!model || typeof model !== "object") {
    return null;
  }

  const id =
    model.id ||
    model.model ||
    model.slug ||
    model.name;

  if (!id) {
    return null;
  }

  return {
    ...model,
    id: String(id),
    name: String(
      model.name ||
      model.displayName ||
      id,
    ),
  };
}

function payloadModels(payload) {
  if (Array.isArray(payload)) {
    return payload
      .map(normalizeModel)
      .filter(Boolean);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of [
    "models",
    "data",
    "results",
  ]) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value
        .map(normalizeModel)
        .filter(Boolean);
    }

    if (
      value &&
      typeof value === "object"
    ) {
      return Object.entries(value)
        .map(([id, item]) => {
          return normalizeModel(
            typeof item === "object"
              ? { id, ...item }
              : { id, name: id },
          );
        })
        .filter(Boolean);
    }
  }

  return [];
}

async function withTimeout(
  promise,
  timeoutMs,
  label,
) {
  let timer;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(
            new Error(
              `${label} timeout after ${timeoutMs}ms`,
            ),
          ),
          timeoutMs,
        );

        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function discoverConnectionModels(
  connection,
) {
  const route =
    await import(
      "../../app/api/providers/[id]/models/route.js"
    );

  if (typeof route.GET !== "function") {
    throw new Error(
      "native provider-model GET route unavailable",
    );
  }

  const request = new Request(
    `http://127.0.0.1/api/providers/${encodeURIComponent(
      connection.id,
    )}/models`,
    {
      method: "GET",
    },
  );

  const response =
    await withTimeout(
      route.GET(
        request,
        {
          params: Promise.resolve({
            id: connection.id,
          }),
        },
      ),
      DYNAMIC_DISCOVERY_TIMEOUT_MS,
      `model discovery ${connection.provider}/${connection.id}`,
    );

  if (
    !response ||
    typeof response.json !== "function"
  ) {
    throw new Error(
      "native provider-model route returned invalid response",
    );
  }

  const payload =
    await response.json();

  if (
    response.status >= 400
  ) {
    const message =
      payload?.error ||
      payload?.message ||
      `HTTP ${response.status}`;

    throw new Error(
      String(message),
    );
  }

  return payloadModels(payload);
}

function staticModelsForProvider(
  providerId,
) {
  const alias =
    PROVIDER_ID_TO_ALIAS?.[providerId] ||
    providerId;

  const models = [
    ...(getProviderModels(alias) || []),
  ];

  if (alias !== providerId) {
    models.push(
      ...(getProviderModels(providerId) || []),
    );
  }

  const unique = new Map();

  for (const raw of models) {
    const model =
      normalizeModel(raw);

    if (model?.id) {
      unique.set(model.id, model);
    }
  }

  return Array.from(
    unique.values(),
  );
}

function connectionAutoEligible(
  connection,
) {
  if (
    connection?.autoModelEnabled === true
  ) {
    return true;
  }

  if (
    connection?.autoModelEnabled === false
  ) {
    return false;
  }

  const authType = String(
    connection?.authType || "",
  ).toLowerCase();

  // Custom / API-key / compatible providers are
  // opt-in only. OAuth defaults to eligible.
  if (
    authType === "apikey" ||
    authType === "api-key" ||
    authType === "compatible" ||
    authType === "custom"
  ) {
    return false;
  }

  return authType === "oauth";
}

function healthFor(
  providerId,
  modelId,
) {
  return (
    getModelHealth(
      providerId,
      modelId,
    ) || {
      status: "unknown",
      success: null,
      latencyMs: null,
      checkedAt: null,
      connectionId: null,
      error: null,
    }
  );
}

async function buildInventory({
  includeDynamic = true,
} = {}) {
  const activeConnections =
    await getProviderConnections({
      isActive: true,
    });

  const registry =
    registryEntries();

  const registryById =
    new Map();

  for (const entry of registry) {
    if (entry?.id) {
      registryById.set(
        entry.id,
        entry,
      );
    }
  }

  const connectionsByProvider =
    new Map();

  for (const connection of activeConnections) {
    if (!connection?.provider) {
      continue;
    }

    const list =
      connectionsByProvider.get(
        connection.provider,
      ) || [];

    list.push(connection);

    connectionsByProvider.set(
      connection.provider,
      list,
    );
  }

  const activeProviderIds =
    new Set(
      activeConnections
        .map((connection) =>
          connection?.provider,
        )
        .filter(Boolean),
    );

  for (const entry of registry) {
    if (
      entry?.id &&
      isConnectionlessFree(entry)
    ) {
      activeProviderIds.add(
        entry.id,
      );
    }
  }

  const providerSummaries = [];
  const inventory = [];
  const errors = [];

  for (
    const providerId of
    Array.from(activeProviderIds).sort()
  ) {
    const entry =
      registryById.get(providerId) ||
      {
        id: providerId,
        name: providerId,
      };

    const connections =
      connectionsByProvider.get(
        providerId,
      ) || [];

    const modelMap =
      new Map();

    for (
      const model of
      staticModelsForProvider(
        providerId,
      )
    ) {
      modelMap.set(
        model.id,
        {
          ...model,
          sources: new Set([
            "registry",
          ]),
        },
      );
    }

    const discoveryErrors = [];

    if (
      includeDynamic &&
      connections.length
    ) {
      const discovered =
        await Promise.all(
          connections.map(
            async (connection) => {
              try {
                return {
                  connection,
                  models:
                    await discoverConnectionModels(
                      connection,
                    ),
                };
              } catch (error) {
                return {
                  connection,
                  error:
                    error?.message ||
                    String(error),
                  models: [],
                };
              }
            },
          ),
        );

      for (const result of discovered) {
        if (result.error) {
          discoveryErrors.push({
            connectionId:
              result.connection.id,
            error:
              result.error,
          });

          errors.push({
            providerId,
            connectionId:
              result.connection.id,
            phase: "model-discovery",
            error:
              result.error,
          });
        }

        for (
          const model of
          result.models
        ) {
          const existing =
            modelMap.get(
              model.id,
            );

          if (existing) {
            existing.sources.add(
              "dynamic",
            );

            Object.assign(
              existing,
              {
                ...model,
                sources:
                  existing.sources,
              },
            );
          } else {
            modelMap.set(
              model.id,
              {
                ...model,
                sources:
                  new Set([
                    "dynamic",
                  ]),
              },
            );
          }
        }
      }
    }

    const providerIsFree =
      isConnectionlessFree(entry);

    const providerLlmEligible =
      providerId !==
      "veoaifree-web";

    const autoModelEligible =
      providerLlmEligible &&
      (
        providerIsFree ||
        connections.some(
          connectionAutoEligible,
        )
      );

    const connectionIds =
      connections.map(
        (connection) =>
          connection.id,
      );

    const models =
      Array.from(
        modelMap.values(),
      ).sort(
        (a, b) =>
          a.id.localeCompare(b.id),
      );

    providerSummaries.push({
      providerId,
      displayName:
        entry?.name ||
        entry?.displayName ||
        providerId,
      category:
        entry?.category ||
        entry?.providerCategory ||
        null,
      connectionless:
        providerIsFree,
      activeConnectionCount:
        connections.length,
      connectionIds,
      modelCount:
        models.length,
      llmRoutingEligible:
        providerLlmEligible,
      autoModelEligible,
      discoveryErrors,
    });

    for (const model of models) {
      const capabilities =
        classifyModelCapabilities(
          providerId,
          model.id,
          model,
        );

      const llmRoutingEligible =
        providerLlmEligible &&
        capabilities.normal &&
        !capabilities.image &&
        !capabilities.video;

      inventory.push({
        canonicalId:
          canonicalModelId(
            providerId,
            model.id,
          ),

        providerId,
        modelId:
          model.id,

        displayName:
          model.name ||
          model.id,

        source:
          Array.from(
            model.sources,
          ).sort(),

        active: true,

        connectionIds,

        capabilities,

        llmRoutingEligible,

        autoModelEligible:
          llmRoutingEligible &&
          autoModelEligible,

        health:
          healthFor(
            providerId,
            model.id,
          ),
      });
    }
  }

  const now =
    new Date().toISOString();

  return {
    version: 1,
    generatedAt:
      now,
    refreshedAt:
      now,

    refreshIntervalMs:
      MODEL_INVENTORY_REFRESH_MS,

    derivedState:
      "process-local",

    canonicalIdentity:
      "providerId+upstreamModelId",

    capabilityOrder: [
      "normal",
      "thinking",
      "code",
      "vision",
      "image",
      "video",
    ],

    providerCount:
      providerSummaries.length,

    modelCount:
      inventory.length,

    providers:
      providerSummaries,

    models:
      inventory,

    errors,
  };
}

export async function refreshModelInventory({
  force = false,
  includeDynamic = true,
} = {}) {
  const existing =
    getModelInventorySnapshot();

  if (
    !force &&
    existing?.refreshedAt
  ) {
    const age =
      Date.now() -
      Date.parse(
        existing.refreshedAt,
      );

    if (
      Number.isFinite(age) &&
      age >= 0 &&
      age <
        MODEL_INVENTORY_REFRESH_MS
    ) {
      return existing;
    }
  }

  const inFlight =
    getRefreshInFlight();

  if (inFlight) {
    return inFlight;
  }

  const refreshPromise =
    buildInventory({
      includeDynamic,
    })
      .then(
        setModelInventorySnapshot,
      )
      .finally(() => {
        setRefreshInFlight(null);
      });

  setRefreshInFlight(
    refreshPromise,
  );

  return refreshPromise;
}

function normalizeHealthResults(
  payload,
  fallbackModels,
) {
  const resultList =
    Array.isArray(payload)
      ? payload
      : Array.isArray(
          payload?.results,
        )
        ? payload.results
        : Array.isArray(
            payload?.models,
          )
          ? payload.models
          : [];

  const output = [];

  for (const item of resultList) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      continue;
    }

    const modelId =
      item.modelId ||
      item.model ||
      item.id;

    if (!modelId) {
      continue;
    }

    const success =
      typeof item.success === "boolean"
        ? item.success
        : typeof item.ok === "boolean"
          ? item.ok
          : null;

    const latency =
      item.latencyMs ??
      item.latency ??
      item.durationMs ??
      item.duration ??
      item.responseTime ??
      null;

    output.push({
      modelId:
        String(modelId),

      success,

      latencyMs:
        Number.isFinite(
          Number(latency),
        )
          ? Number(latency)
          : null,

      error:
        item.error ||
        item.message ||
        null,
    });
  }

  if (
    output.length === 0 &&
    fallbackModels.length === 1
  ) {
    output.push({
      modelId:
        fallbackModels[0],
      success:
        null,
      latencyMs:
        null,
      error:
        null,
    });
  }

  return output;
}

async function probeConnection(
  connection,
  modelIds,
) {
  const route =
    await import(
      "../../app/api/providers/[id]/test-models/route.js"
    );

  if (
    typeof route.POST !== "function"
  ) {
    throw new Error(
      "native test-models POST route unavailable",
    );
  }

  const request =
    new Request(
      `http://127.0.0.1/api/providers/${encodeURIComponent(
        connection.id,
      )}/test-models`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          modelAllowlist:
            modelIds,
        }),
      },
    );

  const response =
    await route.POST(
      request,
      {
        params:
          Promise.resolve({
            id:
              connection.id,
          }),
      },
    );

  const payload =
    await response.json();

  if (response.status >= 500) {
    throw new Error(
      payload?.error ||
      payload?.message ||
      `HTTP ${response.status}`,
    );
  }

  return normalizeHealthResults(
    payload,
    modelIds,
  );
}

export async function probeModelInventory({
  limitPerConnection = 1,
} = {}) {
  const snapshot =
    await refreshModelInventory({
      force: false,
      includeDynamic: false,
    });

  const connections =
    await getProviderConnections({
      isActive: true,
    });

  const limit =
    Math.max(
      1,
      Math.min(
        20,
        Number(
          limitPerConnection,
        ) || 1,
      ),
    );

  const checkedAt =
    new Date().toISOString();

  const errors = [];

  for (const connection of connections) {
    const modelIds =
      snapshot.models
        .filter(
          (model) =>
            model.providerId ===
              connection.provider &&
            model.llmRoutingEligible,
        )
        .slice(0, limit)
        .map(
          (model) =>
            model.modelId,
        );

    if (
      modelIds.length === 0
    ) {
      continue;
    }

    try {
      const results =
        await probeConnection(
          connection,
          modelIds,
        );

      for (const result of results) {
        setModelHealth(
          connection.provider,
          result.modelId,
          {
            status:
              result.success === true
                ? "healthy"
                : result.success === false
                  ? "unhealthy"
                  : "unknown",

            success:
              result.success,

            latencyMs:
              result.latencyMs,

            checkedAt,

            connectionId:
              connection.id,

            error:
              result.error,
          },
        );
      }
    } catch (error) {
      errors.push({
        providerId:
          connection.provider,
        connectionId:
          connection.id,
        error:
          error?.message ||
          String(error),
      });
    }
  }

  const updated = {
    ...snapshot,

    models:
      snapshot.models.map(
        (model) => ({
          ...model,
          health:
            healthFor(
              model.providerId,
              model.modelId,
            ),
        }),
      ),

    healthUpdatedAt:
      checkedAt,

    healthErrors:
      errors,
  };

  setModelInventorySnapshot(
    updated,
  );

  return updated;
}

export function getCurrentModelInventory() {
  return getModelInventorySnapshot();
}
