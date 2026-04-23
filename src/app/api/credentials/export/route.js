import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

function hasCredentialData(connection) {
  return Boolean(
    connection?.accessToken ||
      connection?.refreshToken ||
      connection?.idToken ||
      connection?.apiKey ||
      connection?.projectId ||
      connection?.providerSpecificData,
  );
}

function toCredentialBackupRecord(connection) {
  const keys = [
    "id",
    "provider",
    "authType",
    "name",
    "displayName",
    "email",
    "priority",
    "isActive",
    "defaultModel",
    "globalPriority",
    "accessToken",
    "refreshToken",
    "idToken",
    "apiKey",
    "expiresAt",
    "expiresIn",
    "tokenType",
    "scope",
    "projectId",
    "providerSpecificData",
    "routingStatus",
    "quotaState",
    "healthStatus",
    "authState",
    "reasonCode",
    "reasonDetail",
    "nextRetryAt",
    "resetAt",
    "lastCheckedAt",
    "usageSnapshot",
    "version",
    "lastUsedAt",
    "consecutiveUseCount",
    "backoffLevel",
  ];

  const record = {};
  for (const key of keys) {
    if (connection[key] !== undefined && connection[key] !== null) {
      record[key] = connection[key];
    }
  }
  return record;
}

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const entries = connections
      .filter(hasCredentialData)
      .map(toCredentialBackupRecord);

    return NextResponse.json({
      format: "universal-credentials",
      exportedAt: new Date().toISOString(),
      entries,
    });
  } catch (error) {
    console.log("Error exporting credentials:", error);
    return NextResponse.json(
      { error: "Failed to export credentials" },
      { status: 500 },
    );
  }
}
