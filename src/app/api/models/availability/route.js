import { NextResponse } from "next/server";
import {
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";
import {
  getConnectionProviderCooldownUntil,
  getConnectionStatusDetails,
} from "@/lib/connectionStatus";

const MODEL_LOCK_PREFIX = "modelLock_";

function getFutureTimestamp(value) {
  const timestamp = new Date(value).getTime();
  if (!value || !Number.isFinite(timestamp) || timestamp <= Date.now()) return null;
  return new Date(timestamp).toISOString();
}

function getConnectionName(connection) {
  return connection.name || connection.email || connection.id;
}

function getProviderWideAvailabilityState(connection) {
  const statusDetails = getConnectionStatusDetails(connection);
  const cooldownUntil = getConnectionProviderCooldownUntil(connection);
  const providerStatus = statusDetails.status;
  const hasModelLocks = (statusDetails.activeModelLocks || []).length > 0;
  const hasTimedCooldown = Boolean(cooldownUntil);
  const hasRoutingStatusLock = ["blocked", "exhausted"].includes(connection?.routingStatus);
  const hasQuotaStateLock = ["blocked", "exhausted"].includes(connection?.quotaState);
  const hasProviderStatusLock = providerStatus === "blocked" || providerStatus === "exhausted";
  const hasProviderWideStatusEntry = hasProviderStatusLock;
  const canClearAll = hasTimedCooldown || hasRoutingStatusLock || hasQuotaStateLock || hasModelLocks;

  return {
    statusDetails,
    providerStatus,
    cooldownUntil,
    hasModelLocks,
    hasTimedCooldown,
    hasRoutingStatusLock,
    hasQuotaStateLock,
    hasProviderWideStatusEntry,
    canClearAll,
    clearPatch: {
      ...(hasRoutingStatusLock
        ? { routingStatus: null }
        : {}),
      ...(hasQuotaStateLock
        ? { quotaState: null }
        : {}),
      nextRetryAt: null,
      resetAt: null,
    },
  };
}

function getAvailabilityEntries(connection) {
  const availability = getProviderWideAvailabilityState(connection);

  const modelEntries = (availability.statusDetails.activeModelLocks || []).map((lock) => ({
    provider: connection.provider,
    model: lock.model,
    status: "cooldown",
    until: lock.until,
    connectionId: connection.id,
    connectionName: getConnectionName(connection),
    lastError: connection.reasonDetail || null,
  }));

  const entries = [...modelEntries];

  if (availability.hasProviderWideStatusEntry) {
    entries.unshift({
      provider: connection.provider,
      model: "__all",
      status: availability.providerStatus,
      until: availability.providerStatus === "exhausted" ? (availability.cooldownUntil || undefined) : undefined,
      connectionId: connection.id,
      connectionName: getConnectionName(connection),
      lastError: connection.reasonDetail || null,
    });
  }

  return entries;
}

function buildCooldownClearPatch(connection, model) {
  const patch = {};

  if (model === "__all") {
    const availability = getProviderWideAvailabilityState(connection);

    for (const key of Object.keys(connection || {})) {
      if (key.startsWith(MODEL_LOCK_PREFIX)) patch[key] = null;
    }

    Object.assign(patch, availability.clearPatch);

    return patch;
  }

  patch[`${MODEL_LOCK_PREFIX}${model}`] = null;
  return patch;
}

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const models = [];

    for (const connection of connections) {
      models.push(...getAvailabilityEntries(connection));
    }

    return NextResponse.json({
      models,
      unavailableCount: models.length,
    });
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    return NextResponse.json(
      { error: "Failed to fetch model availability" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const { action, provider, model } = await request.json();

    if (action !== "clearCooldown" || !provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const lockKey = `${MODEL_LOCK_PREFIX}${model}`;

    await Promise.all(
      connections
        .filter((connection) => {
          const availability = getProviderWideAvailabilityState(connection);
          if (model === "__all") {
            return availability.canClearAll;
          }
          return (availability.statusDetails.activeModelLocks || []).some((lock) => lock.key === lockKey);
        })
        .map((connection) => {
          const clearPatch = buildCooldownClearPatch(connection, model);
          const clearedConnection = { ...connection, ...clearPatch };
          const clearedStatusDetails = getConnectionStatusDetails(clearedConnection);
          const shouldReactivate = model === "__all" && clearedStatusDetails.status === "eligible";

          return updateProviderConnection(connection.id, {
            ...clearPatch,
            ...(shouldReactivate
              ? {
                  backoffLevel: 0,
                  reasonCode: "unknown",
                  reasonDetail: null,
                }
              : {}),
          });
        },
        ),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json(
      { error: "Failed to clear cooldown" },
      { status: 500 },
    );
  }
}
