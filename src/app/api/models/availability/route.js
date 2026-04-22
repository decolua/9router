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

function getAvailabilityEntries(connection) {
  const statusDetails = getConnectionStatusDetails(connection);
  const providerCooldownUntil = getConnectionProviderCooldownUntil(connection);
  const providerSurfaceStatus = statusDetails.source?.startsWith("legacy-")
    ? "unknown"
    : statusDetails.status;

  const modelEntries = (statusDetails.activeModelLocks || []).map((lock) => ({
    provider: connection.provider,
    model: lock.model,
    status: "cooldown",
    until: lock.until,
    connectionId: connection.id,
    connectionName: getConnectionName(connection),
    lastError: connection.lastError || connection.reasonDetail || null,
  }));

  const entries = [...modelEntries];

  if (["blocked", "exhausted"].includes(providerSurfaceStatus)) {
    entries.unshift({
      provider: connection.provider,
      model: "__all",
      status: providerSurfaceStatus,
      until: providerSurfaceStatus === "exhausted" ? (providerCooldownUntil || undefined) : undefined,
      connectionId: connection.id,
      connectionName: getConnectionName(connection),
      lastError: connection.lastError || connection.reasonDetail || null,
    });
  }

  return entries;
}

function buildCooldownClearPatch(connection, model) {
  const patch = {};

  if (model === "__all") {
    for (const key of Object.keys(connection || {})) {
      if (key.startsWith(MODEL_LOCK_PREFIX)) patch[key] = null;
    }
    patch.rateLimitedUntil = null;
    patch.nextRetryAt = null;
    patch.resetAt = null;

    if (["blocked_quota", "cooldown", "exhausted"].includes(connection?.routingStatus)) {
      patch.routingStatus = null;
    }

    if (["exhausted", "cooldown", "blocked"].includes(connection?.quotaState)) {
      patch.quotaState = null;
    }

    return patch;
  }

  patch[`${MODEL_LOCK_PREFIX}${model}`] = null;
  return patch;
}

function hasProviderWideCooldownState(connection) {
  return Boolean(
    getFutureTimestamp(connection?.nextRetryAt)
    || getFutureTimestamp(connection?.resetAt)
    || getFutureTimestamp(connection?.rateLimitedUntil)
    || connection?.routingStatus === "blocked_quota"
    || connection?.routingStatus === "cooldown"
    || connection?.routingStatus === "exhausted"
    || ["exhausted", "cooldown", "blocked"].includes(connection?.quotaState),
  );
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
          const statusDetails = getConnectionStatusDetails(connection);
          if (model === "__all") {
            return hasProviderWideCooldownState(connection) || (statusDetails.activeModelLocks || []).length > 0;
          }
          return (statusDetails.activeModelLocks || []).some((lock) => lock.key === lockKey);
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
                  testStatus: "active",
                  lastError: null,
                  lastErrorAt: null,
                  backoffLevel: 0,
                  reasonCode: null,
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
