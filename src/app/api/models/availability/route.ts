import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import {
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";

const MODEL_LOCK_PREFIX = "modelLock_";

interface ModelLock {
  key: string;
  model: string;
  until: JsonValue;
  active: boolean;
}

function getActiveModelLocks(connection: ProviderConnection): ModelLock[] {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]): ModelLock => ({
      key,
      model: key.slice(MODEL_LOCK_PREFIX.length) || "__all",
      until: value as JsonValue,
      active: new Date(String(value)).getTime() > now,
    }))
    .filter((lock) => lock.active);
}

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const models: Array<{
      provider: string;
      model: string;
      status: string;
      connectionId: string;
      connectionName: string;
      lastError: JsonValue;
      until?: JsonValue;
    }> = [];

    for (const connection of connections) {
      const locks = getActiveModelLocks(connection);
      for (const lock of locks) {
        models.push({
          provider: connection.provider,
          model: lock.model,
          status: "cooldown",
          until: lock.until,
          connectionId: connection.id,
          connectionName: String(connection.name ?? connection.email ?? connection.id),
          lastError: (connection["lastError"] ?? null) as JsonValue,
        });
      }

      if (locks.length === 0 && connection["testStatus"] === "unavailable") {
        models.push({
          provider: connection.provider,
          model: "__all",
          status: "unavailable",
          connectionId: connection.id,
          connectionName: String(connection.name ?? connection.email ?? connection.id),
          lastError: (connection["lastError"] ?? null) as JsonValue,
        });
      }
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

export async function POST(request: NextRequest) {
  try {
    const parsed: JsonValue = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const body: Record<string, JsonValue> = { ...parsed };
    const action = body["action"];
    const provider = body["provider"];
    const model = body["model"];

    if (action !== "clearCooldown" || !provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider: String(provider) });
    const lockKey = `${MODEL_LOCK_PREFIX}${String(model)}`;

    await Promise.all(
      connections
        .filter((connection) => connection[lockKey])
        .map((connection) =>
          updateProviderConnection(connection.id, {
            [lockKey]: null,
            ...(connection["testStatus"] === "unavailable"
              ? {
                  testStatus: "active",
                  lastError: null,
                  lastErrorAt: null,
                  backoffLevel: 0,
                }
              : {}),
          }),
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
